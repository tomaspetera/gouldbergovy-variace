"""
Vygeneruje obrázky stránek pro online leták z PDF (CZ + EN).

Použití (ze složky KOD):
    pip install pymupdf pillow
    python tools/build_pages.py
    python tools/build_pages.py --cz cesta/k/CZ.pdf --en cesta/k/EN.pdf

Výstup:
    pages/<lang>/<n>.webp        základní rozlišení (rychlé načtení)
    pages/<lang>/hd/<n>.webp     vysoké rozlišení (načítá se až při přiblížení)
    pages/<lang>/thumb/<n>.webp  náhledy
    pdf/Online_letak_GV_<LANG>.pdf  kopie PDF ke stažení
    assets/leaflet-data.js       rozměry stránek, text stránek (pro SEO a čtečky obrazovky)
                                 a poloha tlačítka na 23poems.com (volné místo na poslední straně)
    og-image.jpg                 náhled pro sdílení na sociálních sítích
"""
import argparse
import io
import json
import re
import shutil
from pathlib import Path

import pymupdf
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BASE_W = 1200
HD_W = 3000
THUMB_W = 240


def render(page, width):
    zoom = width / page.rect.width
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
    return Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")


def clean_text(page):
    """Text stránky po blocích; nadpisy (velké písmo) jdou na začátek."""
    headings, body = [], []
    for b in page.get_text("dict")["blocks"]:
        if b["type"] != 0:  # jen textové bloky
            continue
        spans = [s for line in b["lines"] for s in line["spans"]]
        t = " ".join(s["text"] for s in spans)
        t = re.sub(r"\s+", " ", t).strip()
        t = re.sub(r"(?<=[a-záčďéěíňóřšťúůýž])- (?=[a-záčďéěíňóřšťúůýž])", "", t)
        if not t or re.fullmatch(r"\d+", t):  # vynechá čísla stran
            continue
        size = max(s["size"] for s in spans)
        (headings if size >= 14 else body).append(t)
    return headings + body


def find_cta_gap(page, min_gap=0.07):
    """Najde nejnižší volný vodorovný pruh na stránce (pro tlačítko na web).
    Vrací střed a výšku pruhu jako podíl výšky stránky, nebo None."""
    H = page.rect.height
    spans = [(b[1], b[3]) for b in page.get_text("blocks")]
    spans += [(i["bbox"][1], i["bbox"][3]) for i in page.get_image_info()]
    spans += [(d["rect"].y0, d["rect"].y1) for d in page.get_drawings()]
    spans = sorted((max(a, 0) / H, min(b, H) / H) for a, b in spans if b > a)
    spans = [s for s in spans if s[1] - s[0] < 0.5]  # ignorovat pozadí přes celou stranu

    merged = []
    for a, b in spans:
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    gaps = [(merged[i][1], merged[i + 1][0]) for i in range(len(merged) - 1)]
    gaps = [g for g in gaps if g[1] - g[0] >= min_gap]
    if not gaps:
        return None
    top, bottom = gaps[-1]
    return {"y": round((top + bottom) / 2, 4), "h": round(bottom - top, 4)}


def build(lang, pdf_path):
    doc = pymupdf.open(pdf_path)
    out = ROOT / "pages" / lang
    for sub in ("", "hd", "thumb"):
        (out / sub).mkdir(parents=True, exist_ok=True)

    texts = []
    for i, page in enumerate(doc, start=1):
        hd = render(page, HD_W)
        hd.save(out / "hd" / f"{i}.webp", "WEBP", quality=80, method=6)
        base = hd.resize((BASE_W, round(hd.height * BASE_W / hd.width)), Image.LANCZOS)
        base.save(out / f"{i}.webp", "WEBP", quality=82, method=6)
        thumb = hd.resize((THUMB_W, round(hd.height * THUMB_W / hd.width)), Image.LANCZOS)
        thumb.save(out / "thumb" / f"{i}.webp", "WEBP", quality=75, method=6)
        texts.append(clean_text(page))
        print(f"  {lang} strana {i} hotova")

    pdf_dir = ROOT / "pdf"
    pdf_dir.mkdir(exist_ok=True)
    shutil.copyfile(pdf_path, pdf_dir / f"Online_letak_GV_{lang.upper()}.pdf")

    cta = find_cta_gap(doc[-1])
    if cta:
        print(f"  {lang} tlačítko na web: {cta['y']:.0%} výšky poslední strany")
    else:
        print(f"  {lang} na poslední straně není volné místo, tlačítko bude pod letákem")

    first = doc[0].rect
    return {"pages": doc.page_count, "w": first.width, "h": first.height, "text": texts, "cta": cta}


def build_og_image(pdf_path):
    doc = pymupdf.open(pdf_path)
    W, H = 1200, 630
    canvas = Image.new("RGB", (W, H), (27, 27, 30))
    cover = render(doc[0], 900)
    ch = H - 60
    cover = cover.resize((round(cover.width * ch / cover.height), ch), Image.LANCZOS)
    canvas.paste(cover, ((W - cover.width) // 2, 30))
    canvas.save(ROOT / "og-image.jpg", "JPEG", quality=85)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cz", default=str(ROOT.parent / "Online_letak_GV_CZ.pdf"))
    ap.add_argument("--en", default=str(ROOT.parent / "Online_letak_GV_EN.pdf"))
    args = ap.parse_args()

    data = {"baseWidth": BASE_W, "hdWidth": HD_W, "langs": {}}
    for lang, path in (("cz", args.cz), ("en", args.en)):
        print(f"Zpracovávám {path}")
        data["langs"][lang] = build(lang, path)

    counts = {l: d["pages"] for l, d in data["langs"].items()}
    if len(set(counts.values())) != 1:
        raise SystemExit(f"Jazykové verze mají různý počet stran: {counts}")
    data["pages"] = data["langs"]["cz"]["pages"]
    data["pageWidth"] = data["langs"]["cz"]["w"]
    data["pageHeight"] = data["langs"]["cz"]["h"]

    js = "// Vygenerováno skriptem tools/build_pages.py – needitovat ručně.\nwindow.LEAFLET = "
    js += json.dumps(data, ensure_ascii=False, indent=1) + ";\n"
    (ROOT / "assets").mkdir(exist_ok=True)
    (ROOT / "assets" / "leaflet-data.js").write_text(js, encoding="utf-8")

    build_og_image(args.cz)
    print("Hotovo.")


if __name__ == "__main__":
    main()
