# Déployer Trix derrière Apache 2.4

Le fichier [`config/apache/trix.example.com.conf`](../../config/apache/trix.example.com.conf) est un vhost
Apache 2.4 prêt à l'emploi. Il sert le client Trix en HTTPS pour le domaine
`trix.example.com`. Les chemins de certificat suivent l'arborescence `/etc/pki` des
distributions Red Hat.

## Ce que fait ce vhost

- Il redirige tout le trafic HTTP vers HTTPS en 301.
- Il sert les fichiers statiques du build, en HTTP/2 quand `mod_http2` est chargé.
- Il pose la Content-Security-Policy de production.
- Il met les assets en cache un an, et jamais `index.html`.
- Il compresse HTML, CSS, JavaScript, JSON et SVG.

Trix n'a pas de routage côté client : une seule page est servie. Aucune règle de repli
vers `index.html` n'est donc nécessaire.

Le serveur SIP n'est pas mandaté par Apache. L'utilisateur saisit l'URL `wss://` de son
proxy dans l'écran de configuration. La directive `connect-src 'self' wss:` de la CSP
autorise n'importe quel hôte en WebSocket sécurisé.

## Modules requis

`mod_ssl`, `mod_headers`, `mod_deflate`, `mod_dir`, `mod_alias`. Ajoutez `mod_http2` pour
servir en HTTP/2.

## Installation

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

4. Copiez le vhost et rechargez Apache :

   ```sh
   sudo cp config/apache/trix.example.com.conf /etc/httpd/conf.d/
   sudo apachectl configtest
   sudo systemctl reload httpd
   ```

## Adapter à votre installation

| À changer | Où |
| --- | --- |
| Le domaine | `ServerName`, cible du `Redirect`, noms des logs et des certificats |
| La racine du site | `DocumentRoot` et le bloc `<Directory>` |
| Le répertoire des logs | `/var/log/httpd` devient `/var/log/apache2` sur Debian et Ubuntu |
| Le répertoire des certificats | `/etc/pki/tls` devient `/etc/ssl` sur Debian et Ubuntu |

## Points d'attention

- HSTS est posé sans `includeSubDomains` ni `preload`. Ajoutez-les seulement si tous les
  sous-domaines sont en HTTPS.
- L'agrafage OCSP et le cache de session TLS se règlent au niveau du serveur, pas du
  vhost. Sur Red Hat, `/etc/httpd/conf.d/ssl.conf` fournit déjà `SSLStaplingCache` et
  `SSLSessionCache`.
- La CSP autorise les styles en ligne. Les gabarits de l'interface portent des attributs
  `style`, que la webview met à jour en direct pour les vumètres et la largeur du panneau
  latéral.
- WebRTC exige un contexte sécurisé. Sans HTTPS valide, le navigateur refuse l'accès à la
  caméra et au micro.
