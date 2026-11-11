# READ-002 — Étape B4 : essais sur le NAS avec des contenus réels

> Procédure à dérouler par le propriétaire sur son Synology, une fois les sous-lots B1 à B3 déployés (pages, couvertures, invalidation). Elle reprend la colonne « Étape B » du §4.11 de l'étude (`docs/design/READ-002-connecteur-dossiers.md`) et complète `docs/qa/READ-002-A3-mesures-nas.md`, dont la préparation (§0 : image construite, `.env`, dossier de données, session) reste valable. Le compte rendu chiffré décide de la poursuite vers l'étape C.
>
> Rien ici ne modifie les scans montés : le conteneur les voit en lecture seule. Les essais qui demandent de renommer, remplacer ou supprimer un fichier se font **sur une copie de test** (voir §0), depuis DSM ou en SSH sur le NAS, jamais dans vos vrais scans. Notez les résultats dans le tableau final, sans noms de séries réelles si vous partagez le compte rendu.

## 0. Préparation

1. Reconstruire l'image (la dépendance `yauzl` est installée par `npm ci`) puis redémarrer :
   `docker compose --profile folders build folders && docker compose --profile folders up -d folders`
2. Choisir dans votre bibliothèque réelle, et noter (nombres seulement) :
   - **une longue série** (le plus de chapitres que vous ayez) ;
   - **un chapitre de plusieurs centaines de pages**, en dossier d'images si vous en avez, en CBZ sinon ;
   - **les plus grosses archives** (une de plus de 500 Mo si elle existe) ;
   - une série en dossiers d'images **et** une série en CBZ, pour les couvertures.
3. Une **bibliothèque de test** pour les renommages et remplacements : une copie de deux ou trois petites séries (une en CBZ, une en dossiers d'images) dans un dossier distinct, monté comme bibliothèque supplémentaire (`:ro` dans le conteneur). Les modifications se font côté NAS, dans cette copie.
4. Une fonction pour interroger le service depuis le NAS. Elle ouvre une session, appelle le chemin donné et affiche le code, le type, la taille, le délai du premier octet et le délai total. Les en-têtes de revalidation se passent avec `HDR='{"If-None-Match":"…"}'`.

```sh
fapi() {   # usage : fapi /api/v1/series?size=1     (FOLDERS_USER et FOLDERS_PASSWORD lus dans .env)
  docker exec -e U="$FOLDERS_USER" -e P="$FOLDERS_PASSWORD" -e G="$1" -e HDR="${HDR:-{\}}" scrollarr-folders node --input-type=module -e "
const b='http://127.0.0.1:8788', h={'Content-Type':'application/json','X-Requested-With':'x'};
const r=await fetch(b+'/api/v1/login',{method:'POST',headers:h,body:JSON.stringify({username:process.env.U,password:process.env.P})});
const c=r.headers.get('set-cookie').split(';')[0];
const t=Date.now(); const s=await fetch(b+process.env.G,{headers:{Cookie:c,...JSON.parse(process.env.HDR)}});
const first=Date.now()-t; const body=Buffer.from(await s.arrayBuffer());
console.log(s.status, s.headers.get('content-type'), body.length+' octets', 'etag='+s.headers.get('etag'), 'premier octet '+first+' ms', 'total '+(Date.now()-t)+' ms');
if (!s.headers.get('content-type')?.startsWith('image/')) console.log(body.toString().slice(0,300));"
}
```

Pour obtenir les identifiants : `fapi '/api/v1/series?search=<titre>&size=1'` donne l'`id` de la série, `fapi /api/v1/series/<id>/books` ceux des chapitres (le champ `media.pagesCount` vaut `null` pour une archive tant qu'elle n'a pas été ouverte).

## 1. Chapitre de plusieurs centaines de pages

```sh
fapi /api/v1/books/<chapitre>/pages | head -c 400          # liste : durée, nombre d'entrées (compter les "number")
for n in 1 2 100 250 400; do fapi /api/v1/books/<chapitre>/pages/$n; done
```

Notez : durée de la liste des pages (dossier d'images, puis archive à la première ouverture, puis à la seconde) ; durée du premier octet et poids des pages au début, au milieu et à la fin ; nombre de pages renvoyé par `/pages` comparé à celui du gestionnaire de fichiers (le tri naturel et les fichiers ignorés peuvent le faire différer : noter les écarts) ; ordre des pages correct (ouvrir quelques pages au hasard dans l'application ou comparer les tailles).

## 2. Première ouverture d'une longue série

Redémarrer le conteneur pour partir d'un index vide, puis :

```sh
docker restart scrollarr-folders && sleep 5
fapi '/api/v1/series?search=<titre de la longue série>&size=1'
fapi /api/v1/series/<id>/books | head -c 200                # première ouverture : relecture de tout le sous-arbre
fapi /api/v1/series/<id>/books | head -c 200                # seconde : dans les 30 s, servie depuis l'index
docker stats --no-stream scrollarr-folders
```

Notez : durée de la première et de la seconde réponse pour le nombre de chapitres de la série ; mémoire (`MEM USAGE`) avant et après ; durée de `GET /api/v1/series/<id>/books` à froid (disques endormis) et à chaud.

## 3. Délai de la première page après la veille des disques

Laisser les disques s'endormir (comme au §4 de l'étape A), puis demander **dans cet ordre** une page de CBZ jamais lue, puis une page d'un dossier d'images jamais lu :

```sh
fapi /api/v1/books/<chapitre CBZ>/pages/1
fapi /api/v1/books/<chapitre dossier>/pages/1
fapi /api/v1/books/<chapitre CBZ>/pages/1        # à chaud, pour comparer
```

Notez : délai du premier octet à froid et à chaud pour chacun des deux formats, comparé aux 15 s de l'application (§4.9). Pour un CBZ, la première page lit la fin du fichier (répertoire central) puis l'entrée : deux accès.

## 4. Archives volumineuses ou malformées

**Archives réelles de grande taille** (la plus grosse, puis une de 500 Mo ou plus) :

```sh
( while sleep 1; do docker stats --no-stream --format '{{.MemUsage}}' scrollarr-folders; done ) & STATS=$!
fapi /api/v1/books/<gros chapitre>/pages/1
fapi /api/v1/books/<gros chapitre>/pages/200
kill $STATS
```

La mémoire du conteneur ne doit pas suivre la taille de l'archive (la lecture est en flux, une entrée par requête ; limite du conteneur : 256 Mo).

Notez : taille de l'archive, nombre d'entrées (`/pages`), durée de la liste des pages à froid et à chaud, durée et poids de la page 1 et de la page 200, pic de mémoire pendant la lecture ; si une archive réelle est refusée, le code et le message exacts (422 `archive …`, 413, 415) : s'ils sont dus à une limite (5 000 entrées, 64 Mo par image, taux de compression 200) noter la valeur réelle rencontrée, car elle sert à régler les limites.

**Archive tronquée.** Sur la copie de test, copier un CBZ et en couper la fin (téléchargement interrompu simulé), côté NAS :

```sh
cp "<copie>/Chapitre 001.cbz" "<copie>/Chapitre 099.cbz"
truncate -s -2000 "<copie>/Chapitre 099.cbz"
```

Puis `POST /api/v1/scan` (ou attendre 30 s) et `fapi /api/v1/books/<id du chapitre 099>/pages`.

Notez : code et message attendus `422 archive truncated or corrupt`, pas de plantage du service (`docker logs scrollarr-folders`, `GET /health` toujours `ok`), les autres chapitres de la série restent lisibles.

## 5. Chapitre renommé ou remplacé pendant la lecture

Sur la bibliothèque de test. Ouvrir un chapitre dans l'application (ou noter `fapi /api/v1/books/<id>/pages/1` et son `etag`), puis côté NAS :

1. **Remplacé par un fichier de même taille et de même date** (le cas qu'un simple « taille + date » ne verrait pas) :

```sh
cd "<copie>/<série>"
stat -c '%i %s %y %z' "Chapitre 001.cbz"                                # inode, taille, modification, changement d'état
cp -p "Chapitre 001.cbz" ref.tmp ; touch -r "Chapitre 001.cbz" ref.tmp
# fabriquer un fichier de MÊME taille avec un contenu différent (remplacer un octet d'une image par exemple), puis :
cp autre-contenu.cbz "Chapitre 001.cbz.new" && touch -r ref.tmp "Chapitre 001.cbz.new" && mv "Chapitre 001.cbz.new" "Chapitre 001.cbz"
stat -c '%i %s %y %z' "Chapitre 001.cbz"                                # même taille, même date de modification ; l'inode doit avoir changé
rm ref.tmp
```

Puis `HDR='{"If-None-Match":"<ancien etag>"}' fapi /api/v1/books/<id>/pages/1`. **Attendu : 200 (pas 304) et un nouvel `etag`.**

2. **Réécriture sur place** (même inode) avec la date de modification restaurée : refaire la même chose avec `cat autre-contenu.cbz > "Chapitre 001.cbz" && touch -r ref.tmp "Chapitre 001.cbz"` et vérifier que `%z` (changement d'état) a changé, puis le même `If-None-Match`. **Attendu : 200 et nouvel `etag`.** Si ce n'est pas le cas, noter la sortie de `stat` avant et après : c'est la « limite assumée » de l'étude (§4.8), le recours est `POST /api/v1/scan`.
3. **Renommé** : renommer le chapitre. Attendu : `GET /api/v1/books/<ancien id>/pages/1` → 404, le nouveau chapitre apparaît dans `/books` (au plus 30 s, ou tout de suite après `POST /api/v1/scan`).
4. **Remplacé pendant une lecture en cours** : lancer le téléchargement d'une page volumineuse (`fapi` sur une grande page), remplacer le fichier pendant ce temps (le flux en cours continue sur l'ancien contenu ; ce n'est pas une erreur) et rappeler la page. Attendu : nouvel `etag`, aucune erreur dans `docker logs scrollarr-folders`.

Si le partage du NAS est monté dans le conteneur d'une manière particulière (montage réseau, volume chiffré), refaire les essais 1 et 2 **dans cette configuration exacte** : l'inode et `ctime` y sont moins sûrs (§4.8).

Notez : sortie de `stat` avant/après pour les cas 1 et 2, code HTTP et `etag` observés, délais d'apparition pour le cas 3.

## 6. Fichier supprimé pendant la lecture

Sur la bibliothèque de test. Noter l'identifiant d'un chapitre, puis supprimer son fichier (ou son dossier) côté NAS, sans attendre aucun délai :

```sh
fapi /api/v1/books/<id>/pages/1        # attendu : 404, et la série est relue tout de suite
fapi /api/v1/series/<id série>/books   # le chapitre a disparu de la liste, sans attendre 30 s
```

Remettre ensuite le fichier **au même chemin** : l'identifiant doit redevenir valide (la progression de l'étape C en dépend). Puis démonter ou verrouiller le partage de la bibliothèque de test (comme au §6 de l'étape A) : `pages` et `thumbnail` doivent répondre **503**, jamais 404.

Notez : codes observés à chaque requête, état de `/health`.

## 7. Poids des couvertures

La couverture est la première page non redimensionnée (ou `cover.*`) : son poids n'est pas maîtrisé (risque R8). Mesurer sur toutes les séries réelles :

```sh
# liste des identifiants de séries (500 au plus par appel), puis taille de chaque couverture
docker exec -e U="$FOLDERS_USER" -e P="$FOLDERS_PASSWORD" scrollarr-folders node --input-type=module -e "
const b='http://127.0.0.1:8788', h={'Content-Type':'application/json','X-Requested-With':'x'};
const r=await fetch(b+'/api/v1/login',{method:'POST',headers:h,body:JSON.stringify({username:process.env.U,password:process.env.P})});
const c=r.headers.get('set-cookie').split(';')[0];
const list=(await (await fetch(b+'/api/v1/series?size=500',{headers:{Cookie:c}})).json()).content;
const sizes=[]; let slow=0;
for (const s of list) { const t=Date.now(); const x=await fetch(b+'/api/v1/series/'+s.id+'/thumbnail',{headers:{Cookie:c}}); const n=(await x.arrayBuffer()).byteLength; const ms=Date.now()-t; if (x.status!==200) console.log('statut',x.status); sizes.push(n); if (ms>2000) slow++; }
sizes.sort((a,b)=>a-b); const q=(p)=>sizes[Math.min(sizes.length-1,Math.floor(p*sizes.length))];
console.log('séries',sizes.length,'médiane',q(.5),'p90',q(.9),'max',sizes.at(-1),'total',sizes.reduce((a,b)=>a+b,0),'octets ; plus de 2 s :',slow);"
```

À faire deux fois : couvertures à froid (juste après un redémarrage du conteneur et une veille des disques) puis à chaud. Pour une grille de 30 séries (une page de l'application), le total des 30 couvertures les plus lourdes est ce qu'un téléphone télécharge au premier affichage.

Notez : médiane, p90, maximum et total des couvertures (octets) ; séparément pour les séries en CBZ et en dossiers d'images, et pour celles qui ont un `cover.*`; nombre de couvertures de plus de 1 Mo et de plus de 5 Mo ; durée à froid de l'ensemble ; nombre de séries sans couverture (statut autre que 200) et leur code. Si la première page est souvent une longue planche, le noter : c'est la décision de l'étape D (miniatures).

## Compte rendu à remplir

| Sujet | Résultat (chiffres, versions) | Conforme à l'attente ? |
| --- | --- | --- |
| Chapitre de N pages : liste (ms), page 1 / milieu / fin (ms, Mo) | | Ordre correct ? |
| Première ouverture d'une série de N chapitres (ms) ; mémoire | | |
| Première page après veille : CBZ / dossier (s), à chaud (ms) | | < 15 s ? |
| Plus grosse archive : Mo, entrées, liste (ms), page 200 (ms), pic de mémoire | | Mémoire indépendante de la taille ? |
| Archive réelle refusée par une limite : laquelle, valeur rencontrée | | — |
| Archive tronquée : code, message, service intact | | 422, service intact ? |
| Remplacement à taille et date égales (copie) : inode, `ctime`, code, `etag` | | 200 et nouvel `etag` ? |
| Réécriture sur place, date restaurée : `ctime`, code, `etag` | | 200 et nouvel `etag` ? |
| Montage particulier du partage : mêmes essais | | — |
| Chapitre renommé : 404 ancien identifiant, nouveau visible (délai) | | |
| Fichier supprimé en lecture : 404 puis liste à jour ; fichier remis : identifiant valide | | |
| Partage indisponible : `pages` et `thumbnail` | | 503, jamais 404 ? |
| Couvertures : médiane / p90 / max / total (octets) ; à froid et à chaud | | — |
| Couvertures de plus de 1 Mo / 5 Mo ; séries sans couverture | | — |

**Décision de poursuivre vers l'étape C :** oui / non / oui sous réserve de : …
