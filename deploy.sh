#!/usr/bin/env bash
#
# Construit Trix puis déploie le contenu de dist/ sur le serveur web.
#
# Usage :
#   TARGET_HOST=trix.example.com ./deploy.sh
#   ./deploy.sh --host trix.example.com --dir /autre/racine
#
# Les variables peuvent aussi être posées dans un fichier deploy.env, à côté de
# ce script (non versionné). Voir --help.

set -euo pipefail

racine=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$racine"

# --- Réglages ---------------------------------------------------------------

# Chargés depuis deploy.env s'il existe, puis surchargés par l'environnement et
# enfin par les options de la ligne de commande.
if [[ -f "$racine/deploy.env" ]]; then
  # shellcheck disable=SC1091
  source "$racine/deploy.env"
fi

TARGET_HOST=${TARGET_HOST:-}             # nom ou alias ssh du serveur      (requis)
TARGET_DIR=${TARGET_DIR:-/var/www/trix}  # racine du site sur le serveur
TARGET_USER=${TARGET_USER:-}             # compte ssh, sinon celui par défaut
SSH_PORT=${SSH_PORT:-}                   # port ssh, sinon celui par défaut
SSH_OPTS=${SSH_OPTS:-}                   # options ssh supplémentaires
SSH_MUX=${SSH_MUX:-1}                    # 1 = une seule connexion ssh partagée
REMOTE_SUDO=${REMOTE_SUDO:-0}            # 1 = écrire via sudo sur le serveur
DELETE=${DELETE:-0}                      # 1 = purger aussi hors assets/ (voir --delete)
DRY_RUN=${DRY_RUN:-0}                    # 1 = simuler le transfert
SKIP_BUILD=${SKIP_BUILD:-0}              # 1 = déployer dist/ tel quel
POST_DEPLOY_CMD=${POST_DEPLOY_CMD:-}     # commande à lancer sur le serveur après

usage() {
  cat <<'USAGE'
Construit Trix (npm run build) puis déploie dist/ sur le serveur web.

Options :
  --host HOTE        Serveur cible            (ou TARGET_HOST)
  --dir  CHEMIN      Racine du site distante  (ou TARGET_DIR, par défaut
                     /var/www/trix)
  --user COMPTE      Compte ssh               (ou TARGET_USER)
  --port PORT        Port ssh                 (ou SSH_PORT)
  --sudo             Écrire via sudo côté serveur       (REMOTE_SUDO=1)
  --delete           Purger aussi les fichiers hors assets/ (DELETE=1)
  --dry-run          Simuler, ne rien écrire            (DRY_RUN=1)
  --skip-build       Déployer dist/ sans reconstruire   (SKIP_BUILD=1)
  --post-cmd CMD     Commande lancée sur le serveur à la fin
  --no-mux           Une connexion ssh par étape          (SSH_MUX=0)
  -h, --help         Affiche cette aide

Ces réglages peuvent aussi vivre dans un fichier deploy.env à côté du script :

  TARGET_HOST=trix.example.com
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)     TARGET_HOST=${2:?--host attend une valeur}; shift 2 ;;
    --dir)      TARGET_DIR=${2:?--dir attend une valeur}; shift 2 ;;
    --user)     TARGET_USER=${2:?--user attend une valeur}; shift 2 ;;
    --port)     SSH_PORT=${2:?--port attend une valeur}; shift 2 ;;
    --post-cmd) POST_DEPLOY_CMD=${2:?--post-cmd attend une valeur}; shift 2 ;;
    --sudo)       REMOTE_SUDO=1; shift ;;
    --delete)     DELETE=1; shift ;;
    --dry-run)    DRY_RUN=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --no-mux)     SSH_MUX=0; shift ;;
    -h|--help)  usage; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; usage >&2; exit 2 ;;
  esac
done

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
avert() { printf '\033[1;33m/!\\\033[0m %s\n' "$*" >&2; }
fatal() { printf '\033[1;31mErreur :\033[0m %s\n' "$*" >&2; exit 1; }

[[ -n $TARGET_HOST ]] || fatal "TARGET_HOST n'est pas défini (voir --help)."

case "$TARGET_DIR" in
  /*) ;;
  *)  fatal "TARGET_DIR doit être un chemin absolu (reçu : $TARGET_DIR)." ;;
esac
[[ $TARGET_DIR != "/" ]] || fatal "TARGET_DIR ne peut pas être la racine /."

cible_ssh=$TARGET_HOST
[[ -z $TARGET_USER ]] || cible_ssh="$TARGET_USER@$TARGET_HOST"

# Options communes à ssh, scp et rsync. scp veut -P là où ssh veut -p.
ssh_args=()
scp_args=()
[[ -z $SSH_PORT ]] || { ssh_args+=(-p "$SSH_PORT"); scp_args+=(-P "$SSH_PORT"); }
if [[ -n $SSH_OPTS ]]; then
  # shellcheck disable=SC2206
  extra=($SSH_OPTS)
  ssh_args+=("${extra[@]}")
  scp_args+=("${extra[@]}")
fi

distant_sudo=""
[[ $REMOTE_SUDO != 1 ]] || distant_sudo="sudo "

# --- Construction -----------------------------------------------------------

if [[ $SKIP_BUILD == 1 ]]; then
  info "Construction ignorée (--skip-build), dist/ est déployé tel quel."
  [[ -d dist ]] || fatal "dist/ est absent : impossible de sauter la construction."
else
  command -v npm >/dev/null || fatal "npm est introuvable."
  [[ -d node_modules ]] || { info "Installation des dépendances (npm ci)…"; npm ci; }
  info "Construction (npm run build)…"
  npm run build
fi

[[ -f dist/index.html ]] || fatal "dist/index.html est absent : la construction a échoué."

# --- Vérification des ressources statiques ----------------------------------

# Vite recopie public/ tel quel dans dist/. On le vérifie explicitement : un
# favicon manquant ne casse pas la construction, mais ui/alert.ts s'en sert
# comme canal d'alerte à l'appel entrant, et le site part alors sans icône.
info "Vérification des ressources statiques (favicons, logos)…"
manquants=()
for source in public/*; do
  [[ -e $source ]] || continue
  nom=$(basename "$source")
  [[ -e "dist/$nom" ]] || manquants+=("$nom")
done

# Puis les fichiers réellement référencés par le HTML produit, favicon et
# apple-touch-icon compris : c'est ce que le navigateur ira chercher.
while read -r ref; do
  [[ -n $ref ]] || continue
  [[ -e "dist/${ref#/}" ]] || manquants+=("$ref (référencé par index.html)")
done < <(grep -oE '<link[^>]+rel="[^"]*icon[^"]*"[^>]*>' dist/index.html \
         | grep -oE 'href="[^"]+"' | cut -d'"' -f2)

if (( ${#manquants[@]} )); then
  printf '  - %s\n' "${manquants[@]}" >&2
  fatal "Ressources absentes de dist/ : déploiement interrompu."
fi

# --- Connexion ssh partagée --------------------------------------------------

# Le déploiement enchaîne plusieurs rsync et ssh. Sans multiplexage, chacun
# ouvre sa propre connexion et le serveur redemande le mot de passe à chaque
# fois. Une connexion maîtresse est donc ouverte ici, une seule fois : les
# suivantes passent par sa socket. Un agent ssh ne suffirait pas, il ne retient
# que les clés déchiffrées, jamais un mot de passe de compte.
mux_socket=""
mux_dir=""

fermer_mux() {
  [[ -n $mux_dir ]] || return 0
  ssh -o ControlPath="$mux_socket" -O exit "$cible_ssh" 2>/dev/null || true
  rm -rf -- "$mux_dir"
  mux_dir=""
}

if [[ $SSH_MUX == 1 ]]; then
  mux_dir=$(mktemp -d "${TMPDIR:-/tmp}/trix-deploy.XXXXXX")
  mux_socket="$mux_dir/ssh"
  trap fermer_mux EXIT INT TERM
  info "Connexion à $cible_ssh (mot de passe demandé une seule fois)…"
  if ssh "${ssh_args[@]}" -o ControlMaster=yes -o ControlPath="$mux_socket" \
         -o ControlPersist=60 -fN "$cible_ssh"; then
    ssh_args+=(-o ControlPath="$mux_socket")
    scp_args+=(-o ControlPath="$mux_socket")
  else
    avert "Connexion partagée impossible : le mot de passe sera redemandé à chaque étape."
    rm -rf -- "$mux_dir"
    mux_dir=""
  fi
fi

# --- Transfert --------------------------------------------------------------

info "Déploiement vers $cible_ssh:$TARGET_DIR"
[[ $DRY_RUN != 1 ]] || avert "Simulation (--dry-run) : rien ne sera écrit."

if [[ $DRY_RUN != 1 ]]; then
  ssh "${ssh_args[@]}" "$cible_ssh" "${distant_sudo}mkdir -p -- '$TARGET_DIR'" \
    || fatal "Impossible de créer ou d'atteindre $TARGET_DIR sur $TARGET_HOST."
fi

# Ordre du transfert, pensé pour qu'aucun client ne tombe dans le vide :
#   1. les nouveaux assets et les ressources statiques arrivent ;
#   2. index.html est remplacé, et pointe alors sur des fichiers déjà en place ;
#   3. les anciens assets hachés sont purgés, l'ancien index.html ne servant
#      plus. Sans cette purge, chaque déploiement laisse un bundle mort de plus.
if command -v rsync >/dev/null; then
  rsync_args=(-az --human-readable --checksum)
  [[ $DRY_RUN != 1 ]] || rsync_args+=(--dry-run --verbose)
  [[ -z ${ssh_args[*]} ]] || rsync_args+=(-e "ssh ${ssh_args[*]}")
  [[ $REMOTE_SUDO != 1 ]] || rsync_args+=(--rsync-path="sudo rsync")

  info "Transfert des ressources (rsync)…"
  rsync "${rsync_args[@]}" --exclude=index.html dist/ "$cible_ssh:$TARGET_DIR/"

  info "Transfert de index.html…"
  rsync "${rsync_args[@]}" dist/index.html "$cible_ssh:$TARGET_DIR/"

  if [[ -d dist/assets ]]; then
    info "Purge des anciens assets…"
    rsync "${rsync_args[@]}" --delete dist/assets/ "$cible_ssh:$TARGET_DIR/assets/"
  fi

  if [[ $DELETE == 1 ]]; then
    # Au-delà des assets : tout fichier du site absent de dist/ disparaît.
    info "Purge du reste de $TARGET_DIR (--delete)…"
    rsync "${rsync_args[@]}" --delete dist/ "$cible_ssh:$TARGET_DIR/"
  fi
elif command -v scp >/dev/null; then
  avert "rsync est absent, repli sur scp."
  [[ $DELETE != 1 ]] || avert "--delete est ignoré : scp ne sait pas supprimer hors assets/."
  if [[ $DRY_RUN == 1 ]]; then
    info "Simulation : scp enverrait le contenu de dist/ vers $TARGET_DIR/."
  else
    autres=()
    for entree in dist/*; do
      [[ $(basename "$entree") != index.html ]] && autres+=("$entree")
    done
    info "Transfert des ressources (scp)…"
    (( ${#autres[@]} == 0 )) || scp "${scp_args[@]}" -r -- "${autres[@]}" "$cible_ssh:$TARGET_DIR/"
    info "Transfert de index.html…"
    scp "${scp_args[@]}" -- dist/index.html "$cible_ssh:$TARGET_DIR/"

    if [[ -d dist/assets ]]; then
      # scp ne sait pas supprimer : on liste les assets attendus et on efface
      # côté serveur tout fichier de assets/ qui n'y figure pas. La comparaison
      # se fait sur des noms complets, ligne à ligne, dans le seul assets/.
      info "Purge des anciens assets…"
      attendus=$(cd dist/assets && ls -A)
      printf '%s\n' "$attendus" \
        | ssh "${ssh_args[@]}" "$cible_ssh" \
            "cat > /tmp/trix-assets-attendus.$$ && \
             cd '$TARGET_DIR/assets' 2>/dev/null && \
             ls -A | grep -vxF -f /tmp/trix-assets-attendus.$$ \
               | while IFS= read -r vieux; do \
                   [ -n \"\$vieux\" ] && ${distant_sudo}rm -f -- \"\$vieux\"; \
                 done; \
             rm -f /tmp/trix-assets-attendus.$$" \
        || avert "La purge des anciens assets a échoué : à faire à la main."
    fi
  fi
else
  fatal "Ni rsync ni scp ne sont disponibles."
fi

# --- Après le transfert -----------------------------------------------------

if [[ $DRY_RUN != 1 ]]; then
  # SELinux : sans réétiquetage, le serveur web se voit refuser la lecture des
  # fichiers fraîchement déposés. Le test et la commande tiennent en un seul
  # aller-retour, et ne font rien là où restorecon n'existe pas.
  info "Réétiquetage SELinux si le serveur le demande…"
  ssh "${ssh_args[@]}" "$cible_ssh" \
    "command -v restorecon >/dev/null && ${distant_sudo}restorecon -R -- '$TARGET_DIR' || true" \
    || avert "restorecon a échoué : vérifiez les contextes SELinux à la main."

  if [[ -n $POST_DEPLOY_CMD ]]; then
    info "Commande post-déploiement : $POST_DEPLOY_CMD"
    ssh "${ssh_args[@]}" "$cible_ssh" "$POST_DEPLOY_CMD"
  fi
fi

info "Terminé."
