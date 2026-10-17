"""Local post-authoring tool for amnardinelli.com.

Run: pip install -r requirements.txt && python server.py
Then open http://127.0.0.1:5050 — localhost only, not meant to be exposed.
"""
import json
import re
import struct
import unicodedata
from datetime import datetime
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit
from uuid import uuid4

from flask import Flask, jsonify, render_template, request, send_from_directory
from PIL import Image
from werkzeug.utils import secure_filename

try:
    import pillow_avif  # noqa: F401  (registers the AVIF codec with Pillow)
    AVIF_AVAILABLE = True
except ImportError:
    AVIF_AVAILABLE = False

ROOT = Path(__file__).resolve().parents[2]
POST_DIR = ROOT / "post"
IMAGES_DIR = ROOT / "images" / "posts_images"
INDEX_FILE = ROOT / "index.html"
RSS_FILE = ROOT / "rss.xml"
STYLE_FILE = ROOT / "style.css"
# Work-in-progress drafts live here, separate from published posts. Nothing in
# this dir is linked from the site or committed (see .gitignore).
DRAFT_DIR = Path(__file__).resolve().parent / "drafts"

ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/avif", "image/gif", "image/bmp", "image/tiff"}

app = Flask(__name__, static_folder="static", template_folder="templates")

POST_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
    <head>
        <link rel="alternate" type="application/rss+xml" title="RSS" href="../rss.xml" />
        <meta charset="UTF-8" />
        <link rel="icon" type="image/x-icon" href="../ico/fav.ico">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=12.0, minimum-scale=1.0, user-scalable=yes" />
        <link rel="stylesheet" href="../style.css" />
        <title>{title}</title>
        <meta name="description" content="{description}">
    </head>


    <!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-MPBB9NY5KG"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){{dataLayer.push(arguments);}}
  gtag('js', new Date());

  gtag('config', 'G-MPBB9NY5KG');
</script>


    <body>
        <div class="container">
      <br><br>
      <center>
        <nav>
        <div style="display: inline-block; vertical-align:middle;">
          <img class="ico_small" src="../ico/header.ico" alt="menu_icon">
          <a href="../index.html" class="title"><b>ALESSANDRO NARDINELLI'S WEBSITE</b></a>
          <img class="ico_small" src="../ico/header.ico" alt="menu_icon">
          <hr />
          <a class="title" href="mailto:anardine@hotmail.com">CONTACT</a>
          &nbsp;&nbsp;&nbsp;
          <a class="title" href="../rss.xml">RSS</a>
          &nbsp;&nbsp;&nbsp;&nbsp;
          <a class="title" href="https://www.paypal.com/donate/?hosted_button_id=7U77WSQ5WNW8E">DONATE</a>
        </div>
        </nav>
      </center>
            <div style="margin-bottom:6ch; text-transform: none;"></div>
            <div style="margin-bottom: 2ch;text-transform: none;">{date_meta}</div>
            <h1>{title}</h1>
            <hr>
{content}
            <footer>
                <br><br>*<br>
                &copy; {year} Alessandro Nardinelli
                <br><br>
            </footer>
        </div>
    </body>
</html>
"""


def slugify(text):
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return text


def rfc822(date_str):
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    return dt.strftime("%a, %d %b %Y 00:00:00 GMT")


def display_date(date_str):
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    return f"{dt.strftime('%b')} {dt.day}, {dt.year}"


def index_date(date_str):
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    return dt.strftime("%d/%m/%Y")


def render_post_html(meta, content_html):
    if meta.get("date_meta_raw"):
        date_meta = meta["date_meta_raw"]
    else:
        date_meta = f"{display_date(meta['date'])} &middot; {meta['read_minutes']} min read<br>"
        if meta.get("updated"):
            date_meta += f"Updated: {meta['updated']}<br>"
    return POST_TEMPLATE.format(
        title=meta["title"],
        description=meta["description"],
        date_meta=date_meta,
        content=content_html,
        year=datetime.strptime(meta["date"], "%Y-%m-%d").year,
    )


def extract_article(html):
    title_m = re.search(r"<title>(.*?)</title>", html, re.S)
    desc_m = re.search(r'<meta name="description" content="(.*?)"\s*/?>', html, re.S)
    date_meta_m = re.search(
        r'<div style="margin-bottom:\s*2ch;text-transform:\s*none;">(.*?)</div>', html, re.S
    )
    date_m = re.search(
        r'\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\b',
        date_meta_m.group(1) if date_meta_m else "",
    )
    post_date = ""
    if date_m:
        try:
            post_date = datetime.strptime(date_m.group(0), "%b %d, %Y").strftime("%Y-%m-%d")
        except ValueError:
            pass
    content_m = re.search(r"<h1>.*?</h1>\s*<hr\s*/?>(.*)<footer>", html, re.S)
    return {
        "title": title_m.group(1).strip() if title_m else "",
        "description": desc_m.group(1).strip() if desc_m else "",
        "date_meta": date_meta_m.group(1).strip() if date_meta_m else "",
        "date": post_date,
        "content": content_m.group(1).strip() if content_m else "",
    }


def update_index(title, slug, date_str):
    html = INDEX_FILE.read_text(encoding="utf-8")
    if f"./post/{slug}.html" in html:
        return False
    new_line = f'{index_date(date_str)}: <a href="./post/{slug}.html">{title}</a><br>\n'
    anchor = re.search(r'(<h2>ARTICLES</h2>\s*<hr>\s*<p style="text-align: left;">\s*\n)', html)
    if not anchor:
        return False
    html = html[: anchor.end()] + new_line + html[anchor.end() :]
    INDEX_FILE.write_text(html, encoding="utf-8")
    return True


def update_rss(title, slug, description, date_str):
    xml = RSS_FILE.read_text(encoding="utf-8")
    if f"/post/{slug}.html" in xml:
        return False
    pub_date = rfc822(date_str)
    xml = re.sub(r"(<pubDate>).*?(</pubDate>)", rf"\g<1>{pub_date}\g<2>", xml, count=1)
    xml = re.sub(r"(<lastBuildDate>).*?(</lastBuildDate>)", rf"\g<1>{pub_date}\g<2>", xml, count=1)
    url = f"https://amnardinelli.com/post/{slug}.html"
    item = (
        "         <item>\n"
        f"            <title>{title}</title>\n"
        f"            <link>{url}</link>\n"
        f"            <description>{description}</description>\n"
        f"            <pubDate>{pub_date}</pubDate>\n"
        f"            <guid>{url}</guid>\n"
        "        </item>\n"
    )
    anchor = re.search(r'(<atom:link[^>]*/>\s*\n)', xml)
    if not anchor:
        return False
    xml = xml[: anchor.end()] + item + xml[anchor.end() :]
    RSS_FILE.write_text(xml, encoding="utf-8")
    return True


@app.route("/")
def editor_page():
    return render_template("editor.html")


@app.route("/site-style.css")
def site_style():
    return send_from_directory(STYLE_FILE.parent, STYLE_FILE.name)


@app.route("/images/<path:filename>")
def site_images(filename):
    # Post content uses "../images/..." which resolves to "/images/..." in the
    # editor; serve the site's images dir so they render in the canvas.
    return send_from_directory(ROOT / "images", filename)


@app.route("/tools/postmaker/static/<path:filename>")
def viewer_assets(filename):
    return send_from_directory(app.static_folder, filename)


@app.route("/font/<path:filename>")
def site_fonts(filename):
    # style.css references "./font/..." → "/font/..." here; serve them so the
    # canvas renders in the site's actual typeface instead of a fallback.
    return send_from_directory(ROOT / "font", filename)


@app.route("/api/posts")
def list_posts():
    posts = []
    for path in sorted(POST_DIR.glob("*.html")):
        html = path.read_text(encoding="utf-8")
        title_m = re.search(r"<title>(.*?)</title>", html, re.S)
        posts.append({"slug": path.stem, "title": title_m.group(1).strip() if title_m else path.stem})
    return jsonify(posts)


@app.route("/api/posts/<slug>")
def get_post(slug):
    slug = secure_filename(slug)
    path = POST_DIR / f"{slug}.html"
    if not path.exists():
        return jsonify({"error": "not found"}), 404
    html = path.read_text(encoding="utf-8")
    data = extract_article(html)
    data["slug"] = slug
    return jsonify(data)


@app.route("/api/upload-image", methods=["POST"])
def upload_image():
    slug = slugify(request.form.get("slug", ""))
    if not slug:
        return jsonify({"error": "slug is required"}), 400
    file = request.files.get("file")
    if file is None or file.mimetype not in ALLOWED_IMAGE_TYPES:
        return jsonify({"error": "unsupported or missing image file"}), 400

    folder = IMAGES_DIR / slug
    folder.mkdir(parents=True, exist_ok=True)
    existing = [int(p.stem) for p in folder.glob("*") if p.stem.isdigit()]
    idx = max(existing) + 1 if existing else 0

    try:
        img = Image.open(file.stream)
        img.load()
    except Exception:
        return jsonify({"error": "could not read image"}), 400

    ext = "avif" if AVIF_AVAILABLE else "webp"
    warning = None if AVIF_AVAILABLE else "pillow-avif-plugin not installed; saved as .webp instead"
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
    out_path = folder / f"{idx}.{ext}"
    img.save(out_path, format=ext.upper(), quality=82)

    return jsonify({"url": f"../images/posts_images/{slug}/{idx}.{ext}", "warning": warning})


@app.route("/api/upload-stl", methods=["POST"])
@app.route("/api/upload-model", methods=["POST"])
def upload_model():
    max_size = 25 * 1024 * 1024
    if request.content_length and request.content_length > max_size + 1024 * 1024:
        return jsonify({"error": "model file must be at most 25 MB"}), 413
    slug = slugify(request.form.get("slug", ""))
    if not slug:
        return jsonify({"error": "slug is required"}), 400
    file = request.files.get("file")
    extension = Path(file.filename or "").suffix.lower() if file is not None else ""
    if extension not in {".stl", ".obj", ".usdz", ".gltf", ".glb"}:
        return jsonify({"error": "an STL, OBJ, USDZ, glTF, or GLB file is required"}), 400
    content = file.stream.read(max_size + 1)
    if not content:
        return jsonify({"error": "model file is empty"}), 400
    if len(content) > max_size:
        return jsonify({"error": "model file must be at most 25 MB"}), 413

    assets = {}
    if extension in {".gltf", ".glb"}:
        manifest_data = content
        if extension == ".glb":
            if (len(content) < 20 or struct.unpack_from("<III", content) != (0x46546C67, 2, len(content))):
                return jsonify({"error": "invalid glTF 2.0 GLB header"}), 400
            json_size, chunk_type = struct.unpack_from("<II", content, 12)
            if chunk_type != 0x4E4F534A or json_size > len(content) - 20:
                return jsonify({"error": "invalid GLB JSON chunk"}), 400
            manifest_data = content[20:20 + json_size]
        try:
            manifest = json.loads(manifest_data)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return jsonify({"error": "invalid glTF JSON"}), 400
        if (not isinstance(manifest, dict) or not isinstance(manifest.get("asset"), dict)
                or manifest["asset"].get("version") != "2.0"):
            return jsonify({"error": "only glTF 2.0 models are supported"}), 400
        uploads = {asset.filename: asset for asset in request.files.getlist("assets")}
        total_size = len(content)
        for field in ("buffers", "images"):
            entries = manifest.get(field, [])
            if not isinstance(entries, list):
                return jsonify({"error": f"invalid glTF {field}"}), 400
            for entry in entries:
                if not isinstance(entry, dict):
                    return jsonify({"error": f"invalid glTF {field} entry"}), 400
                uri = entry.get("uri")
                if uri is None:
                    continue
                if not isinstance(uri, str):
                    return jsonify({"error": "invalid glTF asset URI"}), 400
                if uri.startswith("data:"):
                    continue
                try:
                    parsed = urlsplit(uri)
                    asset_path = unquote(parsed.path, errors="strict")
                except (ValueError, UnicodeDecodeError):
                    return jsonify({"error": "invalid glTF asset URI"}), 400
                path = PurePosixPath(asset_path)
                if (parsed.scheme or parsed.netloc or parsed.query or parsed.fragment
                        or not asset_path or path.is_absolute() or ".." in path.parts
                        or "\\" in asset_path or "\0" in asset_path
                        or path.suffix.lower() not in {".bin", ".png", ".jpg", ".jpeg", ".webp", ".avif", ".ktx2"}):
                    return jsonify({"error": "glTF assets must be relative .bin or texture files inside the model folder"}), 400
                name = path.as_posix()
                if name in assets:
                    continue
                asset = uploads.get(name)
                if asset is None:
                    return jsonify({"error": f"missing glTF asset: {name}; select the folder containing the model"}), 400
                data = asset.stream.read(max_size - total_size + 1)
                total_size += len(data)
                if total_size > max_size:
                    return jsonify({"error": "model and assets must total at most 25 MB"}), 413
                if not data:
                    return jsonify({"error": f"glTF asset is empty: {name}"}), 400
                assets[name] = data

    folder = IMAGES_DIR / slug
    name = f"model-{uuid4().hex}{extension}"
    if extension in {".gltf", ".glb"}:
        folder /= Path(name).stem
        name = f"model{extension}"
    folder.mkdir(parents=True, exist_ok=True)
    for asset_name, data in assets.items():
        asset_path = folder / asset_name
        asset_path.parent.mkdir(parents=True, exist_ok=True)
        asset_path.write_bytes(data)
    (folder / name).write_bytes(content)
    relative = (folder / name).relative_to(IMAGES_DIR).as_posix()
    return jsonify({"url": f"../images/posts_images/{relative}"})


def draft_path(draft_id):
    # Drafts are keyed by a stable id (assigned once, in the editor) so renaming
    # the post's title later updates the same file instead of creating a new one.
    draft_id = secure_filename(draft_id) or "untitled"
    return DRAFT_DIR / f"{draft_id}.json"


@app.route("/api/drafts")
def list_drafts():
    DRAFT_DIR.mkdir(exist_ok=True)
    drafts = []
    for path in DRAFT_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        drafts.append(
            {"id": path.stem, "title": data.get("title") or path.stem, "saved_at": data.get("saved_at", "")}
        )
    drafts.sort(key=lambda d: d["saved_at"], reverse=True)
    return jsonify(drafts)


@app.route("/api/draft/<draft_id>")
def get_draft(draft_id):
    path = draft_path(draft_id)
    if not path.exists():
        return jsonify({"error": "not found"}), 404
    return jsonify(json.loads(path.read_text(encoding="utf-8")))


@app.route("/api/draft", methods=["POST"])
def save_draft():
    """Persist a work-in-progress draft to disk, keyed by its stable id. Never publishes."""
    DRAFT_DIR.mkdir(exist_ok=True)
    payload = request.get_json(force=True)
    title = (payload.get("title") or "").strip()
    if not title:
        return jsonify({"error": "a title is required to save a draft"}), 400
    draft_id = payload.get("id") or slugify(title) or datetime.now().strftime("draft-%Y%m%d%H%M%S")
    payload["id"] = draft_id
    payload["saved_at"] = datetime.now().isoformat(timespec="seconds")
    draft_path(draft_id).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return jsonify({"ok": True, "id": draft_id, "saved_at": payload["saved_at"]})


@app.route("/api/draft/<draft_id>", methods=["DELETE"])
def delete_draft(draft_id):
    path = draft_path(draft_id)
    if path.exists():
        path.unlink()
    return jsonify({"ok": True})


@app.route("/api/save", methods=["POST"])
def save_post():
    payload = request.get_json(force=True)
    mode = payload.get("mode", "new")
    title = payload["title"].strip()
    slug = slugify(payload.get("slug") or title)
    if not slug:
        return jsonify({"error": "title/slug required"}), 400

    meta = {
        "title": title,
        "description": payload.get("description", "").strip(),
        "date": payload.get("date") or datetime.now().strftime("%Y-%m-%d"),
        "read_minutes": payload.get("read_minutes") or 5,
        "updated": payload.get("updated", "").strip(),
        "date_meta_raw": payload.get("date_meta_raw", "").strip(),
    }
    content_html = payload.get("content", "").strip()

    html = render_post_html(meta, content_html)
    (POST_DIR / f"{slug}.html").write_text(html, encoding="utf-8")

    index_updated = rss_updated = False
    if mode == "new":
        index_updated = update_index(meta["title"], slug, meta["date"])
        rss_updated = update_rss(meta["title"], slug, meta["description"], meta["date"])

    return jsonify(
        {
            "ok": True,
            "slug": slug,
            "file": f"post/{slug}.html",
            "index_updated": index_updated,
            "rss_updated": rss_updated,
        }
    )


if __name__ == "__main__":
    if not AVIF_AVAILABLE:
        print("WARNING: pillow-avif-plugin not installed — images will be saved as .webp")
    app.run(host="127.0.0.1", port=5050, debug=True)
