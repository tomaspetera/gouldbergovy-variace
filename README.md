# Online leták – Gouldbergovy variace (CZ / EN)

Běží na **https://tomaspetera.github.io/gouldbergovy-variace/** (GitHub Pages z větve `main`).

Úpravy nasadíte tak, že je commitnete a pushnete do `main`, GitHub web během minuty aktualizuje:

```
git add -A
git commit -m "Aktualizace letáku"
git push
```

Statický web, nepotřebuje žádný server ani databázi. Jde nahrát i na jiný hosting.

## Co nahrát na jiný hosting

```
index.html
og-image.jpg
assets/
pages/
pdf/
```

Složky `tools/` a `.claude/` a tento README nahrávat nemusíte.

Při přesunu na jinou adresu upravte v `index.html` `og:url` a `og:image`,
aby se při sdílení na Facebooku nebo ve WhatsAppu zobrazil náhled obálky.

## Odkazy

- `…/letak/` – jazyk podle prohlížeče (čeština/slovenština → CZ, jinak EN)
- `…/letak/?lang=en` – rovnou anglicky
- `…/letak/#cz/4` – konkrétní jazyk a strana

## Nová verze letáku

Nové PDF uložte vedle složky `KOD` pod stejnými názvy (`Online_letak_GV_CZ.pdf`,
`Online_letak_GV_EN.pdf`) a spusťte:

```
pip install pymupdf pillow
python tools/build_pages.py
```

Skript znovu vygeneruje obrázky stran, náhledy, text pro vyhledávače a kopie PDF ke stažení.
Obě jazykové verze musí mít stejný počet stran.

Tlačítko „Navštivte 23poems.com“ se na poslední straně umístí automaticky do nejnižšího
volného pruhu (aspoň 7 % výšky strany). Když na poslední straně volné místo nebude,
zobrazí se tlačítko plovoucí nad spodní lištou. Adresa odkazu je v `index.html` (`id="cta"`).

## Lokální náhled

```
python -m http.server 8765
```

a otevřít http://localhost:8765
