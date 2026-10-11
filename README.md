# LHP 5-7 Web Tracker

Tracker de carte **en direct dans le navigateur** pour **Lego Harry Potter Years 5-7** sur Archipelago.
C'est l'équivalent web de la page « Map » d'Universal Tracker : mêmes cartes, mêmes pastilles, avec la logique de
l'apworld recalculée directement dans le navigateur. Pas de serveur, pas de YAML.

- Connexion à n'importe quelle room (`archipelago.gg:PORT` + nom du slot), en mode `Tracker` : lecture seule, sans
  gêner le client du jeu.
- 41 cartes du pack [LHP5-7_AP_UniversalTracker](https://github.com/jonnytheagent/LHP5-7_AP_UniversalTracker),
  avec les pastilles **vert** (accessible), **vert/rouge** (partiel), **rouge** (bloqué) et **gris** (fait).
- Logique extraite automatiquement de l'apworld (`lhp2.apworld`), donc avec les mêmes règles qu'Universal Tracker,
  options du slot comprises (jetons, red bricks, prix des boutiques, multiplicateurs…).
- **Suivre le joueur** : la carte change toute seule selon la zone où tu es en jeu.
- Mise à jour en temps réel, reconnexion automatique, zoom et déplacement à la souris ou au doigt.

## Comment obtenir chaque check

Clique sur une pastille : pour chaque check pas encore fait, le tracker affiche ce qu'il faut pour l'obtenir.

- **Accès « Zone » :** ce qui manque pour atteindre la zone ou le niveau (par exemple Diffindo + 📜 la leçon
  DADA pour Knockturn Alley).
- **Il faut :** les sorts, capacités et objets demandés par le check lui-même, par exemple
  `✗ Polynectar + ✓ Magie noire`.

Chaque élément est marqué **✓** si tu l'as déjà et **✗** sinon. Les capacités de groupe (Magie noire, Force, Creuser,
Clé, Clé à molette…) listent au survol les personnages qui les donnent. 📜 désigne un événement de l'histoire à faire
en jeu. Ces règles viennent directement de l'apworld : ce sont les mêmes que la
[feuille de logique](https://docs.google.com/spreadsheets/d/1NiUMwyz902CagQeW7hnq1QdrJ2xljVG4yJy64sx5FR4), adaptées
aux options de ton slot.

**Avec le spoiler (optionnel) :** télécharge le spoiler depuis la page de la room (*Download Spoiler*), puis charge-le
avec le bouton **Charger le spoiler** ou glisse-le sur la page. Pour chaque item qui te manque, le tracker indique
alors où il se trouve : *📍 Diffindo : XiJick — ftb 60D9…*. Seule la partie qui concerne ton slot est gardée dans le
navigateur. Le navigateur ne peut pas télécharger le spoiler tout seul depuis archipelago.gg, qui bloque ces requêtes.

Le spoiler ajoute aussi, sous chaque check, **ce qu'il donne** : *🎁 16 Iron Ore (pour Tomy_Sensei)* ou
*🎁 Reducto (pour toi)*.

## Rechercher un item

Le champ **🔎 Rechercher un item…** en haut de la barre de gauche cherche parmi tous les items du jeu (et, avec le
spoiler, ceux de tes amis qui sont cachés dans ton monde). Pour chaque item, il indique :

- si tu l'as déjà reçu (et combien de fois) ;
- avec le spoiler, où il se trouve (*📍 XiJick — ftb 60D9…*) ;
- les checks de ton monde qui contiennent cet item pour d'autres joueurs (*🎁 Pour Tomy_Sensei — Knockturn Alley:
  Student in Peril*).

Un clic sur un check de ton monde ouvre la bonne carte, zoome sur la pastille et affiche ses prérequis.

## Onglets de la barre de gauche

- **Cartes** : la liste des 41 cartes, avec le nombre de checks accessibles sur le nombre restant.
- **À faire** : tous les checks faisables maintenant, regroupés par carte dans l'ordre des zones. Un clic ouvre la
  carte ou la pastille.
- **Priorités** : pour chaque item qui te manque, le nombre de checks qu'il rendrait accessibles tout de suite
  (*Diffindo → +31*), du plus utile au moins utile. Les items équivalents sont regroupés (par exemple n'importe quel
  perso de Magie noire). Avec le spoiler, on voit chez qui ils sont, et on peut déplier la liste des checks débloqués.
- **Inventaire** : sorts et capacités reçus ou non, capacités des personnages (Magie noire, Force, Creuser, Clé…) avec
  les persos qui te les donnent, niveaux débloqués, multiplicateurs de score.
- **Hints** : les hints demandés dans la room (`!hint`). D'un côté, où sont tes items ; de l'autre, ce que cachent
  tes checks. Les checks hintés ont un anneau violet sur la carte. Dans la bulle, ils sont marqués 💡 en violet et
  leur contenu s'affiche, même sans spoiler.

## Démarrer

```bash
npm install
npm run dev
```

Puis ouvre http://localhost:5173, renseigne le serveur (ex. `archipelago.gg:58927`) et ton slot, et clique sur
**Connexion**.

> Sur archipelago.gg, le port d'une room change quand elle se rendort. Si la connexion échoue, ouvre la page de la
> room pour la réveiller et reprends le nouveau port.

Paramètres d'URL utiles, pour un lien à partager ou une source OBS :

```
?host=archipelago.gg:58927&slot=Kapette&autoconnect=1
```

## Mettre en ligne

```bash
npm run build
```

Le dossier `dist/` (~9 Mo) est un site 100 % statique, avec des chemins relatifs. Il se dépose tel quel sur GitHub
Pages, Netlify, Cloudflare Pages ou n'importe quel hébergeur. Il doit être servi en **https** : archipelago.gg accepte
les connexions `wss://`.

## Mettre à jour les données

Les données générées sont dans `src/data/` et `public/maps/`. Tu ne dois les régénérer que si le pack ou l'apworld
change.

| Commande | Source | Produit |
| --- | --- | --- |
| `npm run pack -- chemin/vers/pack.zip` | pack Universal Tracker (.zip) | `public/maps/*.webp`, `src/data/pack.json` |
| `npm run logic -- chemin/vers/lhp2.apworld` | apworld du jeu | `src/data/logic.json` |

Sans argument, `pack` prend le premier `.zip` à la racine et `logic` prend
`C:\ProgramData\Archipelago\custom_worlds\lhp2.apworld`.

`tools/extract_logic.py` importe l'apworld avec des stubs minimalistes du framework Archipelago (`tools/stubs/`).
Il enregistre chaque `set_rule` sous forme d'arbre JSON, que `src/logic.ts` évalue ensuite comme le ferait
Archipelago : expansion des régions depuis `Menu` et collecte des events, répétées jusqu'à stabilité. Les résultats ont
été comparés à Universal Tracker sur une vraie partie : même nombre de checks en logique.

## Structure

```
src/
  main.ts          UI : liste des cartes, pastilles, popover, stats
  viewer.ts        visionneuse de carte (zoom / pan / pinch)
  archipelago.ts   client WebSocket Archipelago (tag Tracker)
  logic.ts         évaluation de la logique
  explain.ts       règles -> prérequis lisibles (✓ / ✗)
  spoiler.ts       lecture du spoiler (où sont tes items)
  insights.ts      items qui débloquent le plus, données de l'inventaire
  panels.ts        onglets À faire / Priorités / Inventaire / Hints
  mapIndex.ts      id de carte du jeu -> onglet (porté de l'apworld)
  data/            logic.json + pack.json (générés)
public/maps/       images des cartes en WebP (générées)
tools/             scripts de génération + stubs Archipelago
```

## Crédits

Pack de cartes par jonnytheagent, apworld Lego Harry Potter 5-7 par jradcode23.
