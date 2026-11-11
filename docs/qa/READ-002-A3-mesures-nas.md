# READ-002 — Étape A3 : essais et mesures sur le NAS

> Procédure à dérouler par le propriétaire sur son Synology, une fois les sous-lots A1 et A2 déployés. Elle reprend la colonne « Étape A » du §4.11 de l'étude (`docs/design/READ-002-connecteur-dossiers.md`). Le compte rendu chiffré décide de la poursuite vers l'étape B.
>
> Rien ici ne modifie les scans : tout se fait avec un montage en lecture seule. Notez les résultats dans le tableau final, sans noms de séries réelles si vous partagez le compte rendu.

## 0. Préparation

1. Depuis un clone du dépôt, sur la branche livrée : `docker compose --profile folders build folders`.
2. Dans `.env` : `FOLDERS_SCANS_PATH=/volume1/<partage>/<dossier_de_scans>` et `FOLDERS_AUTH=password` avec `FOLDERS_USER` et `FOLDERS_PASSWORD` (12 caractères au moins).
3. Dossier de données, au nom de l'utilisateur du conteneur (1000:1000 par défaut, voir `FOLDERS_UID` et `FOLDERS_GID`) : `mkdir -p data/folders && chown 1000:1000 data/folders`.
4. Aucun port n'est publié. Pour interroger le service, passer par le conteneur :

```sh
# exemple : GET sans session (doit répondre 401), puis /health
docker exec scrollarr-folders node -e "fetch('http://127.0.0.1:8788/api/v1/libraries').then(r=>console.log(r.status))"
docker exec scrollarr-folders node -e "fetch('http://127.0.0.1:8788/health').then(r=>r.json()).then(j=>console.log(JSON.stringify(j)))"
```

   Pour les appels authentifiés, ouvrir une session et réutiliser le cookie (à adapter, mot de passe lu dans `.env`) :

```sh
docker exec -e U="$FOLDERS_USER" -e P="$FOLDERS_PASSWORD" scrollarr-folders node --input-type=module -e "
const b='http://127.0.0.1:8788', h={'Content-Type':'application/json','X-Requested-With':'x'};
const r=await fetch(b+'/api/v1/login',{method:'POST',headers:h,body:JSON.stringify({username:process.env.U,password:process.env.P})});
const c=r.headers.get('set-cookie').split(';')[0];
const t=Date.now(); const s=await fetch(b+'/api/v1/series?size=1',{headers:{Cookie:c}});
console.log(s.status, Date.now()-t,'ms');"
```

Notez : version du DSM, version du noyau (`uname -r`), version du moteur Docker (`docker version`), modèle de disques (HDD ou SSD), et si le partage est chiffré.

## 1. Permissions et ACL

But : l'utilisateur du conteneur lit le dossier partagé et écrit `/data`.

```sh
docker compose --profile folders up -d folders
docker logs scrollarr-folders            # attendu : « Dossiers à l'écoute… » puis « Parcours terminé… »
docker exec scrollarr-folders id         # utilisateur et groupe réels du conteneur
docker exec scrollarr-folders ls -ld /libraries/Scans /data
docker exec scrollarr-folders ls /libraries/Scans | head
docker exec scrollarr-folders test -s /data/secret.key && echo "data inscriptible"
```

Notez : le service démarre-t-il ? Sinon, le message exact (aucune bibliothèque, `/data` non inscriptible). Si le dossier de scans n'est pas lisible, ajuster les droits ou ACL du partage pour l'identifiant `FOLDERS_UID:FOLDERS_GID`, puis noter ce qui a été nécessaire.

## 2. Partages et montages

```sh
docker exec scrollarr-folders sh -c 'touch /libraries/Scans/essai' ; echo "code=$?"   # attendu : refus, code non nul
docker exec scrollarr-folders sh -c 'touch /app/essai' ; echo "code=$?"                # refus (système de fichiers en lecture seule)
docker exec scrollarr-folders sh -c 'touch /essai' ; echo "code=$?"                    # refus
docker exec scrollarr-folders grep libraries /proc/mounts                              # options « ro »
docker exec scrollarr-folders sh -c 'mount | grep "/libraries"'                        # y a-t-il des sous-montages sous /libraries ?
uname -r ; docker version --format '{{.Server.Version}}'
ls -la /volume1/<partage>/<dossier_de_scans>/essai 2>&1                                # le fichier ne doit pas exister sur le NAS
```

Notez : écriture refusée (oui/non) pour chacun des trois essais ; options de montage ; présence de sous-montages dans le dossier monté (si le noyau est antérieur à 5.12, ils restent inscriptibles : monter un dossier sans sous-montage) ; versions du noyau et de Docker.

Isolation réseau (critère de sortie de l'étape A) : depuis l'intérieur du conteneur, rien d'extérieur ne doit répondre.

```sh
docker exec scrollarr-folders node -e "for (const u of ['https://example.com','http://1.1.1.1']) fetch(u,{signal:AbortSignal.timeout(5000)}).then(r=>console.log(u,'RÉPOND',r.status),e=>console.log(u,'injoignable',e.cause?.code||e.message))"
docker exec scrollarr-folders node -e "require('dns').lookup('example.com',(e,a)=>console.log('DNS externe:',e?e.code:a))"
# une machine du réseau local (adresse du NAS ou d'un autre équipement) :
docker exec scrollarr-folders node -e "fetch('http://<ADRESSE_LOCALE>:<PORT>',{signal:AbortSignal.timeout(5000)}).then(r=>console.log('RÉPOND',r.status),e=>console.log('injoignable',e.cause?.code||e.message))"
# un autre conteneur (adresse lue par « docker network inspect <reseau_de_la_pile> ») :
docker exec scrollarr-folders node -e "fetch('http://<ADRESSE_CONTENEUR>:<PORT>',{signal:AbortSignal.timeout(5000)}).then(r=>console.log('RÉPOND',r.status),e=>console.log('injoignable',e.cause?.code||e.message))"
# ce qui reste joignable sur la passerelle du réseau interne :
docker network inspect <projet>_folders_net --format '{{(index .IPAM.Config 0).Gateway}}'
docker exec scrollarr-folders node -e "fetch('http://<PASSERELLE>:<PORT_DU_NAS>',{signal:AbortSignal.timeout(5000)}).then(r=>console.log('RÉPOND',r.status),e=>console.log('injoignable',e.cause?.code||e.message))"
```

Le nom du réseau est préfixé par le nom du projet Compose (`docker network ls | grep folders_net`). Pour la passerelle, essayer les ports que le NAS écoute (DSM 5000/5001, SSH 22, SMB 445) et noter lesquels répondent : la documentation Docker indique que l'adresse de passerelle reste joignable. Notez : chaque cible répond ou non ; liste de ce qui répond sur la passerelle.

## 3. Dossiers très peuplés, temps de parcours, mémoire

Sur une bibliothèque réelle, puis sur un dossier de plusieurs milliers d'entrées (par exemple `FOLDERS_SCANS_PATH` pointant sur le dossier le plus fourni).

```sh
# Parcours complet à chaud (le service est déjà démarré) : durée annoncée dans le journal
docker logs scrollarr-folders 2>&1 | grep "Parcours terminé"
# Parcours à froid : redémarrer (le cache disque du NAS peut rester chaud ; pour un vrai départ à froid, redémarrer le NAS ou attendre la mise en veille des disques)
docker restart scrollarr-folders && sleep 5 && docker logs scrollarr-folders 2>&1 | grep -E "Parcours terminé|à l'écoute"
# Mémoire et processus
docker stats --no-stream scrollarr-folders
# Nombre de séries et de chapitres vus, avertissements
# (GET /api/v1/scan avec la session, voir §0)
```

Pour fabriquer un dossier de test volumineux sans toucher aux vrais scans (sur une copie hors des scans, jamais dans le dossier monté en `:ro`) : `node dev/make-folders-fixture.mjs /volume1/<test>/folders-demo --bulk 5000` crée 5 000 séries de 3 chapitres (nécessite Node sur le NAS ou un conteneur `node:22-alpine` avec le dépôt monté), à monter ensuite comme bibliothèque supplémentaire.

Notez : nombre de séries et de chapitres ; durée du parcours à froid et à chaud (ms, journal) ; mémoire (`MEM USAGE`) au repos et pendant un parcours ; durée d'une liste `GET /api/v1/series?size=30` ; démarrage à froid inférieur ou non à 1 minute (seuil Q9 de l'étude) ; nombre et nature des avertissements (`GET /api/v1/scan`) : ils servent à corriger les heuristiques de nommage.

## 4. Disques sortant de veille

L'application abandonne une requête au bout de 15 s (§4.9). Laisser les disques s'endormir (durée de mise en veille réglée dans DSM, ou attendre la nuit), puis :

```sh
# première requête après la veille : mesurer le délai (session ouverte comme au §0)
docker exec -e U="$FOLDERS_USER" -e P="$FOLDERS_PASSWORD" scrollarr-folders node --input-type=module -e "
const b='http://127.0.0.1:8788', h={'Content-Type':'application/json','X-Requested-With':'x'};
const r=await fetch(b+'/api/v1/login',{method:'POST',headers:h,body:JSON.stringify({username:process.env.U,password:process.env.P})});
const c=r.headers.get('set-cookie').split(';')[0];
for (let i=0;i<3;i++){const t=Date.now(); const s=await fetch(b+'/api/v1/series?size=1',{headers:{Cookie:c}}); console.log(s.status, Date.now()-t,'ms');}"
```

Le service ne touche pas aux disques pour `/health` (la vérification de santé de Docker ne les réveille pas). L'index se rafraîchit à la demande : la liste des séries relit le dossier racine si la dernière lecture date de plus de 60 s, une fiche relit la série si elle date de plus de 30 s.

Notez : délai de la première réponse après veille, et des suivantes ; comparaison aux 15 s de l'application ; nombre de secondes de veille avant l'essai.

## 5. Renommages pendant l'utilisation

Sur une copie de test (pas sur les vrais scans, le montage étant en lecture seule : faire le renommage depuis DSM ou en SSH sur le NAS, dans une bibliothèque de test montée en lecture seule dans le conteneur).

1. Noter l'identifiant d'une série (`GET /api/v1/series?search=<titre>`) et de ses chapitres (`/api/v1/series/<id>/books`).
2. Renommer le dossier de la série sur le NAS.
3. Rappeler `GET /api/v1/series/<ancien id>` : attendu **404** (série renommée = nouvelle série). Rappeler la liste : le nouveau nom apparaît, avec un nouvel identifiant.
4. Renommer ensuite un chapitre seul : l'ancien identifiant de chapitre répond 404, le nouveau apparaît dans `/books`.
5. Ajouter un fichier en profondeur (`<série>/<tome>/<chapitre>/`) et vérifier qu'il apparaît sans redémarrage, au plus 30 s plus tard.

Notez : comportement observé à chaque étape, délais d'apparition.

## 6. Fichiers devenus indisponibles : 503, pas 404

C'est le point le plus important de l'étape A : un 404 sur une série ferait supprimer l'abonnement correspondant dans l'application.

1. Relever `GET /health` (état `ok` de la bibliothèque) et l'identifiant d'une série (`/api/v1/series?size=1`).
2. Rendre le partage indisponible, par l'un des moyens que vous utilisez réellement : démonter le dossier chiffré ou verrouiller le volume dans DSM, ou arrêter le partage. Attention : ne pas supprimer de fichiers.
3. Immédiatement, puis après 1 minute :

```sh
# (avec la session ouverte comme au §0 : même script, en changeant le chemin demandé)
GET /api/v1/series?library=<id>        # attendu : 503 (jamais 200 avec une liste vide, jamais 404)
GET /api/v1/series/<id>                # attendu : 503
GET /api/v1/series/0123456789abcdef    # identifiant inconnu : 503 aussi tant que la bibliothèque est indisponible
GET /health                            # état « unavailable » pour la bibliothèque concernée (après une première requête touchant la bibliothèque)
```

4. Redémarrer le conteneur **pendant** l'indisponibilité : l'état doit rester « unavailable » (un drapeau est conservé dans `data/folders/libraries.json`).
5. Rendre le partage : les mêmes requêtes redeviennent `200` sans redémarrage, au plus 60 s plus tard.
6. Cas voulu d'une bibliothèque vraiment vidée : `POST /api/v1/scan` confirme qu'elle est vide.

Notez : code HTTP observé à chaque requête, y compris juste après le verrouillage ; si le dossier monté apparaît vide, absent ou en erreur d'entrée-sortie côté conteneur (`docker exec scrollarr-folders ls /libraries/Scans`) ; état de `/health`.

## Compte rendu à remplir

| Sujet | Résultat (chiffres, versions) | Conforme à l'attente ? |
| --- | --- | --- |
| Versions : DSM, noyau, Docker, disques | | — |
| Permissions : le service démarre, lit le partage, écrit `/data` | | |
| `:ro` effectif sur `/libraries`, `/app` et `/` | | |
| Sous-montages sous `/libraries` | | |
| Isolation : Internet, DNS, réseau local, autre conteneur | | |
| Joignable sur la passerelle (ports) | | — |
| Bibliothèque réelle : séries / chapitres / avertissements | | — |
| Parcours à froid / à chaud (ms), mémoire (Mo) | | Démarrage à froid < 1 min ? |
| Dossier de plusieurs milliers d'entrées : durée, mémoire | | |
| Première réponse après veille des disques (s) | | < 15 s ? |
| Série renommée, chapitre renommé, ajout profond | | |
| Partage indisponible : codes HTTP, état `/health`, redémarrage pendant l'indisponibilité | | 503 partout, jamais 404 ? |

**Décision de poursuivre vers l'étape B :** oui / non / oui sous réserve de : …
