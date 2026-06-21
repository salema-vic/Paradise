# ParaTV Fullscreen Playlist Player — chaîne par défaut configurable

Cette version utilise la playlist principale ParaTV :

```text
https://raw.githubusercontent.com/Paradise-91/ParaTV/main/playlists/paratv/main/paratv-highest.m3u
```

Le lien GitHub d'origine était :

```text
https://github.com/Paradise-91/ParaTV/blob/main/playlists/paratv/main/paratv-highest.m3u
```

## Cibler une autre première chaîne

Tu as 3 possibilités.

### Option 1 — Par URL, sans modifier le code

Exemples :

```text
http://localhost:8080/?channel=tf1
http://localhost:8080/?channel=france%202
http://localhost:8080/?channel=m6
http://localhost:8080/?index=3
```

`channel` cherche dans le nom, le titre, l'id, le groupe et l'URL du flux.

`index` utilise la position de la chaîne dans la playlist. L'index commence à `0`.

### Option 2 — Dans `app.js`, par nom

Dans `app.js`, modifie :

```js
const DEFAULT_CHANNEL_NAME = "";
```

Exemple :

```js
const DEFAULT_CHANNEL_NAME = "France 2";
```

### Option 3 — Dans `app.js`, par index

Dans `app.js`, modifie :

```js
const DEFAULT_CHANNEL_INDEX = null;
```

Exemple :

```js
const DEFAULT_CHANNEL_INDEX = 3;
```

## Caractéristiques

- affichage plein page ;
- `object-fit: fill` ;
- autoplay muet ;
- bouton de contrôles semi-transparent en haut à droite ;
- sélection de chaîne depuis la playlist principale ;
- rechargement manuel du flux ;
- rechargement manuel de la playlist principale ;
- rechargement automatique de la playlist principale toutes les 10 minutes ;
- rechargement automatique avant expiration du token quand l'expiration est détectable ;
- rechargement automatique sur erreur HLS.

## Utilisation

Dézippe le dossier, puis lance un serveur local :

```bash
python -m http.server 8080
```

Puis ouvre :

```text
http://localhost:8080
```

## Raccourcis clavier

- `M` : activer/couper le son.
- `Espace` : lecture/pause.
- `R` : recharger le flux.
