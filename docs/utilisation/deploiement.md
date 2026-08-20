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

3. Installez le certificat et sa clé :

   - `/etc/pki/tls/certs/trix.example.com-fullchain.crt` contient le certificat du
     serveur, puis les intermédiaires, dans cet ordre.
   - `/etc/pki/tls/private/trix.example.com.key` contient la clé privée. Mettez-la en
     mode `0600` et propriété `root`.

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
