# Déployer Trix

Trix se construit en fichiers statiques. Un serveur web les sert en HTTPS, et c'est tout :
il n'y a pas de backend à installer avec le client.

Deux configurations prêtes à l'emploi sont fournies pour le domaine `trix.example.com` :

- Apache 2.4 : [`config/apache/trix.example.com.conf`](../../config/apache/trix.example.com.conf)
- nginx : [`config/nginx/trix.example.com.conf`](../../config/nginx/trix.example.com.conf)

Les chemins de certificat suivent l'arborescence `/etc/pki` des distributions Red Hat.

## Ce que font ces configurations

- Elles redirigent tout le trafic HTTP vers HTTPS en 301, en conservant le chemin.
- Elles servent les fichiers statiques du build, en HTTP/2.
- Elles posent la Content-Security-Policy de production.
- Elles mettent les assets en cache un an, et jamais `index.html`.
- Elles compressent HTML, CSS, JavaScript, JSON et SVG.

Trix n'a pas de routage côté client : une seule page est servie. Aucune règle de repli
vers `index.html` n'est donc nécessaire.

Le serveur SIP n'est pas mandaté par le serveur web. L'utilisateur saisit l'URL `wss://` de
son proxy dans l'écran de configuration. La directive `connect-src 'self' wss:` de la CSP
autorise n'importe quel hôte en WebSocket sécurisé.

## Construire et installer les fichiers

1. Construisez le client :

   ```sh
   npm ci
   npm run build
   ```

2. Copiez le contenu de `dist/` dans la racine du site :

   ```sh
   sudo mkdir -p /var/www/trix
   sudo cp -r dist/. /var/www/trix/
   sudo restorecon -R /var/www/trix   # systèmes avec SELinux
   ```

   La construction produit **deux pages** : `index.html`, le client, et
   `share_account.html`, celle qui reçoit un compte partagé par lien
   (docs/CONCEPTION.md §6.1). Toutes deux sont des fichiers statiques : aucune
   réécriture d'URL n'est à configurer, mais les deux doivent être servies —
   `share_account.html` absente, les liens déjà envoyés tombent sur un 404.
   `deploy.sh` le vérifie avant de transférer quoi que ce soit.

   Le lien de partage porte sa charge dans le **fragment** de l'URL
   (`share_account.html#data=…`), qui ne quitte jamais le navigateur : rien de ce
   qu'il transporte — le HA1 du compte, le mot de passe TURN — n'apparaît dans les
   journaux d'accès du serveur. L'en-tête `Referrer-Policy: no-referrer` des vhosts
   fournis achève de l'empêcher de fuir vers un tiers ; si vous écrivez votre propre
   configuration, gardez-le.

3. Installez le certificat et sa clé :

   - `/etc/pki/tls/certs/trix.example.com-fullchain.crt` contient le certificat du
     serveur, puis les intermédiaires, dans cet ordre.
   - `/etc/pki/tls/private/trix.example.com.key` contient la clé privée. Mettez-la en
     mode `0600` et propriété `root`.

## Préconfigurer le client : `config.json`

Trix lit au démarrage un fichier `config.json` **posé à côté de `index.html`**, dans la
racine du site. Il n'est pas dans le build : c'est la configuration de *votre*
installation, pas celle du dépôt, et une mise à jour du client ne l'écrase pas.

Ce fichier fixe ce que vos utilisateurs n'ont pas à choisir. Chaque réglage qu'il impose
**disparaît de l'écran des paramètres** : un champ qu'on ne peut pas changer n'a pas à
être lu.

**Le fichier est facultatif.** Absent, illisible ou mal formé, Trix se comporte
exactement comme sans lui — le formulaire complet est affiché. Chaque clé est
indépendante : n'écrivez que celles que vous voulez imposer.

Un gabarit complet est fourni : [`config/config.json.example`](../../config/config.json.example).

```json
{
  "sip_server": "wss://sip.example.com:8443/ws",
  "sip_domain": "example.com",
  "stun_server": "stun.example.com:3478",
  "turn_server": "turn.example.com:5349",
  "turn_username": "trix",
  "turn_password": "change-me",
  "turn_tls": true,
  "realtime_text": "user_choice",
  "debug_activated": "yes",
  "presence": "yes",
  "messaging": "yes"
}
```

| Clé | Effet |
| --- | --- |
| `sip_server` | Le proxy SIP (`wss://…` ou `ws://…`). Le champ « Serveur SIP » disparaît des paramètres. Une valeur sans schéma WebSocket est ignorée : mieux vaut un champ visible qu'un proxy injoignable et invisible. |
| `sip_domain` | Le domaine SIP. Le champ « Adresse SIP » part prérempli à `user@domaine`, et **seule** une adresse de ce domaine est acceptée. |
| `stun_server` | L'hôte STUN (`hôte` ou `hôte:port`, schéma `stun:` toléré). |
| `turn_server`, `turn_username`, `turn_password`, `turn_tls` | Le relais TURN. Sans identifiant **et** mot de passe, le relais est ignoré : TURN n'a pas de mode anonyme. |
| `realtime_text` | `"none"`, `"websocket"`, `"datachannel"` ou `"user_choice"`. Les trois premières valeurs imposent le transport et retirent le menu ; `"user_choice"` le laisse. Avec `"none"`, toute mention du tchat quitte l'interface. |
| `debug_activated` | `"no"` retire la case « Trace SIP » et éteint la trace, y compris pour qui l'avait laissée allumée. Toute autre valeur, ou l'absence de clé, laisse la case. |
| `messaging` | `"no"` éteint la messagerie instantanée : aucun MESSAGE ne part, ceux qui arrivent reçoivent 405, et l'en-tête `Allow` ne cite plus la méthode. Le fil ne montre plus que les appels. Toute autre valeur, ou l'absence de clé, l'allume. |
| `presence` | `"no"` éteint la présence : aucun SUBSCRIBE ni PUBLISH ne part, le menu de statut disparaît et la pastille reste « Enregistré ». Les contacts restent affichés et appelables, sans glyphe. Toute autre valeur, ou l'absence de clé, laisse Trix découvrir ce que le serveur accepte. |

Quelques conséquences à connaître :

- **La colonne « Traversée de NAT » part d'un bloc.** Elle disparaît dès que le fichier
  parle de STUN ou de TURN — même pour dire qu'il n'y en a pas (`"stun_server": ""`).
  N'en imposer qu'un laisserait une demi-section à remplir.
- **Un compte déjà enregistré est réaligné** sur le proxy, les serveurs ICE et le
  transport texte imposés, à la relecture. En revanche, un compte enregistré sur un
  **autre domaine** que `sip_domain` est écarté et l'utilisateur reconfigure le sien :
  son empreinte de mot de passe (HA1) a été calculée avec l'ancien domaine comme
  *realm*, et rien ne peut la rattraper.
- **La présence n'a pas besoin de cette clé pour s'adapter au serveur.** À chaque
  enregistrement, Trix essaie SUBSCRIBE et PUBLISH et s'en tient à ce qui est accepté :
  un serveur qui répond 489 ou 405 au SUBSCRIBE vaut un bandeau et des contacts sans
  glyphe, un PUBLISH refusé retire le choix du statut. `"presence": "no"` sert à
  l'exploitant qui sait que son serveur n'en veut pas et ne souhaite voir partir aucune
  de ces requêtes. Ne pas déranger est éteint avec le reste : aucun appel n'est refusé
  à cause d'un statut choisi auparavant.
- **La messagerie non plus n'a pas besoin de cette clé pour s'adapter.** Si le proxy
  répond 405 ou 501 à un MESSAGE, Trix affiche un bandeau et ferme l'écriture jusqu'au
  prochain enregistrement. `"messaging": "no"` sert à ne rien essayer du tout.
- **Le mot de passe TURN y est en clair**, comme dans toute configuration WebRTC servie
  à un navigateur. Ce fichier est public : n'y mettez aucun secret que vous ne
  distribueriez pas à vos utilisateurs.
- **Il ne doit pas être mis en cache.** Les deux configurations fournies s'en chargent,
  au même titre qu'`index.html`.

Installez-le à la main, une fois :

```sh
sudo install -m 0644 config/config.json.example /var/www/trix/config.json
sudo vi /var/www/trix/config.json
```

`deploy.sh` ne le transfère pas et ne le supprime pas, `--delete` compris.

## Messagerie instantanée : ce que le serveur SIP doit faire

Trix envoie et reçoit des SIP MESSAGE (RFC 3428) en `text/plain`, enveloppé dans CPIM
comme chez Linphone ([ADR 0008](../architecture/0008-messagerie.md),
[ADR 0009](../architecture/0009-cpim.md)). Le proxy doit :

1. **router MESSAGE** vers les contacts enregistrés du destinataire, comme un INVITE ;
2. **garder les messages d'un destinataire désinscrit** et les lui remettre à son
   prochain REGISTER. C'est une **exigence** : quand le navigateur endort l'onglet, Trix
   se désinscrit (ADR 0006), et sans ce stockage tout message écrit pendant ce temps est
   refusé (480) à l'expéditeur, et Trix ne le voit jamais.

Avec Kamailio, c'est le module `msilo`. L'extrait suivant montre la forme à donner à la
route ; il est **à adapter** à votre configuration et n'a pas encore été validé en réel
avec Trix :

```
loadmodule "msilo.so"
modparam("msilo", "db_url", DBURL)
modparam("msilo", "from_address", "sip:registrar@example.com")
# pas de « [Offline message - …] » en tête du texte : Trix date le message lui-même
modparam("msilo", "add_date", 0)

request_route {
    # …
    if (is_method("REGISTER")) {
        if (!save("location")) sl_reply_error();
        # remet ce qui attendait ce destinataire
        m_dump();
        exit;
    }
    if (is_method("MESSAGE")) {
        if (!lookup("location")) {
            # désinscrit : gardé, et « accepté » pour l'expéditeur
            if (m_store("$ru")) send_reply("202", "Accepted");
            else send_reply("503", "Service Unavailable");
            exit;
        }
        t_relay();
        exit;
    }
    # …
}
```

Trix range un message remis en différé à la date de son en-tête CPIM `DateTime`, ou de
son en-tête SIP `Date`, quand il en porte un, et à l'heure de réception sinon. Un message
CPIM remis deux fois (même `imdn.Message-ID`) n'est rangé qu'une fois ; un message en texte
brut remis deux fois apparaît deux fois. Vérifiez ce que votre version de `msilo`
pose dans les messages qu'elle remet.

Asterisk (PJSIP) route MESSAGE par le plan de numérotation (`MessageSend`) mais ne garde
rien : les messages envoyés à un Trix endormi y sont perdus.

Ce que Trix ne fait pas, et qu'aucune configuration ne changera : un message **envoyé**
depuis un autre appareil du même compte n'apparaît pas dans Trix. SIP n'a pas
l'équivalent des copies de XMPP.

## Déployer avec `deploy.sh`

Le script [`deploy.sh`](../../deploy.sh) enchaîne les deux étapes précédentes : il construit
le client, vérifie que les favicons et les logos sont bien dans `dist/`, puis transfère le
tout par rsync, ou par scp si rsync manque.

```sh
./deploy.sh --host trix.example.com
```

Seul le serveur est à donner : la racine du site vaut `/var/www/trix` par défaut, et
`--dir` la remplace au besoin. Les deux réglages peuvent aussi venir de l'environnement
(`TARGET_HOST`, `TARGET_DIR`) ou d'un fichier `deploy.env` posé à côté du script, qui
n'est pas versionné :

```sh
TARGET_HOST=trix.example.com
REMOTE_SUDO=1          # écrire dans /var/www exige souvent sudo
```

Le déploiement enchaîne plusieurs `rsync` et `ssh`. Pour que le serveur ne réclame pas le
mot de passe à chaque étape, le script ouvre une connexion ssh maîtresse et la partage
entre toutes les autres (`ControlMaster`) : une seule authentification par déploiement.
`--no-mux` revient à une connexion par étape, si le serveur refuse le multiplexage.

Un agent ssh ne remplace pas ce mécanisme : il retient des clés privées déchiffrées, pas
un mot de passe de compte. Pour supprimer la saisie tout à fait, passez à
l'authentification par clé — `ssh-copy-id vous@trix.example.com` — et confiez la
passphrase de la clé à `ssh-agent`.

Avec `REMOTE_SUDO=1`, le `sudo` distant s'exécute sans terminal : il ne peut pas demander
de mot de passe. Accordez au compte de déploiement une règle `NOPASSWD` sur `rsync`,
`mkdir` et `restorecon`, ou déployez dans un répertoire dont il est propriétaire.

`index.html` est envoyé après les assets, et les assets périmés du déploiement précédent
sont effacés seulement une fois la nouvelle page en place : à aucun instant le serveur ne
sert une page qui référence des fichiers absents. `restorecon` est lancé automatiquement
si le serveur l'a. `./deploy.sh --help` liste le reste : `--dry-run`, `--skip-build`,
`--delete` pour purger aussi les fichiers hors `assets/`, `--post-cmd` pour une commande
finale.

## Apache 2.4

Modules requis : `mod_ssl`, `mod_headers`, `mod_deflate`, `mod_dir`, `mod_alias`. Ajoutez
`mod_http2` pour servir en HTTP/2.

```sh
sudo cp config/apache/trix.example.com.conf /etc/httpd/conf.d/
sudo apachectl configtest
sudo systemctl reload httpd
```

L'agrafage OCSP et le cache de session TLS se règlent au niveau du serveur, pas du vhost.
Sur Red Hat, `/etc/httpd/conf.d/ssl.conf` fournit déjà `SSLStaplingCache` et
`SSLSessionCache`.

## nginx

Le fichier doit être inclus dans le contexte `http`, car il déclare une directive `map`.
Le répertoire `/etc/nginx/conf.d/` remplit cette condition.

```sh
sudo cp config/nginx/trix.example.com.conf /etc/nginx/conf.d/
sudo nginx -t
sudo systemctl reload nginx
```

HTTP/2 est activé par `listen 443 ssl http2`, la forme comprise par toutes les versions en
service. À partir de nginx 1.25.1, cette forme émet un avertissement au démarrage. Vous
pouvez alors la remplacer par `listen 443 ssl;` plus une ligne `http2 on;`.

## Adapter à votre installation

| À changer | Où |
| --- | --- |
| Le domaine | `ServerName` ou `server_name`, cible de la redirection, noms des logs et des certificats |
| La racine du site | `DocumentRoot` et le bloc `<Directory>`, ou `root` |
| Le répertoire des logs | `/var/log/httpd` devient `/var/log/apache2` sur Debian et Ubuntu |
| Le répertoire des certificats | `/etc/pki/tls` devient `/etc/ssl` sur Debian et Ubuntu |

## Points d'attention

- HSTS est posé sans `includeSubDomains` ni `preload`. Ajoutez-les seulement si tous les
  sous-domaines sont en HTTPS.
- La CSP autorise les styles en ligne. Les gabarits de l'interface portent des attributs
  `style`, que la webview met à jour en direct pour les vumètres et la largeur du panneau
  latéral.
- Sous nginx, un `add_header` placé dans un bloc `location` annule tous les en-têtes
  hérités du bloc `server`. La configuration fournie évite ce piège : le `Cache-Control`
  variable vient d'une `map`, et tous les en-têtes restent déclarés au niveau `server`.
- WebRTC exige un contexte sécurisé. Sans HTTPS valide, le navigateur refuse l'accès à la
  caméra et au micro.
- `config.json` est servi tel quel, sans cache. Vérifiez-le après chaque modification :
  `curl -s https://trix.example.com/config.json | python3 -m json.tool`. Une virgule en
  trop et Trix repart en formulaire complet, sans rien signaler à l'utilisateur.
- `sw.js` est le service worker des notifications (ADR 0006, D2 bis) : c'est lui qui affiche
  l'alerte quand le navigateur endort l'onglet, parce que la page ne le peut plus. Il doit
  être servi **depuis la racine du site** et **sans cache** — les deux configurations
  fournies s'en chargent. Il n'intercepte aucune requête et ne met rien en cache : un
  déploiement ne demande donc aucune purge côté navigateur. Sans lui, Trix retombe sur une
  notification ordinaire, qui suffit tant que la page tourne mais pas au gel.
