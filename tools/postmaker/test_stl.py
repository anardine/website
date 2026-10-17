import base64
import io
import json
import struct
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit

import server


ASCII_STL = b"""solid triangle
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid triangle
"""
BINARY_STL = b"\0" * 80 + struct.pack("<I12fH", 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0)
OBJ_MODEL = b"""mtllib ignored.mtl
o first
v 10 20 30
v 11 20 30
v 10 21 30
usemtl ignored
f 1 2 3
o second
v 10 20 31
f -4 -3 -1
"""
USDA_MODEL = b"""#usda 1.0
(
    defaultPrim = "Triangle"
    upAxis = "Z"
    metersPerUnit = 0.01
)
def Xform "Triangle"
{
    double3 xformOp:translate = (10, 20, 30)
    uniform token[] xformOpOrder = ["xformOp:translate"]
    def Mesh "Mesh"
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
        uniform token subdivisionScheme = "none"
    }
}
"""


def make_usdz():
    stream = io.BytesIO()
    info = zipfile.ZipInfo("triangle.usda")
    padding = (-(30 + len(info.filename) + 4)) % 64
    info.extra = struct.pack("<HH", 0x1986, padding) + b"\0" * padding
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr(info, USDA_MODEL)
    return stream.getvalue()


GLTF_BUFFER = struct.pack("<9f", 0, 0, 0, 1, 0, 0, 0, 1, 0)


def gltf_document(uri=None):
    return {
        "asset": {"version": "2.0"},
        "buffers": [{
            "byteLength": len(GLTF_BUFFER),
            "uri": uri or "data:application/octet-stream;base64," + base64.b64encode(GLTF_BUFFER).decode(),
        }],
        "bufferViews": [{"buffer": 0, "byteLength": len(GLTF_BUFFER)}],
        "accessors": [{
            "bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3",
            "min": [0, 0, 0], "max": [1, 1, 0],
        }],
        "materials": [{"doubleSided": True, "pbrMetallicRoughness": {
            "baseColorFactor": [1, 0.2, 0.1, 1], "metallicFactor": 0,
        }}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "material": 0}]}],
        "nodes": [{"mesh": 0, "translation": [10, 20, 30]}],
        "scenes": [{"nodes": [0]}],
        "scene": 0,
    }


def make_glb(document=None):
    document = document or gltf_document()
    document["buffers"][0].pop("uri", None)
    data = json.dumps(document).encode()
    data += b" " * (-len(data) % 4)
    return (
        struct.pack("<III", 0x46546C67, 2, 28 + len(data) + len(GLTF_BUFFER))
        + struct.pack("<II", len(data), 0x4E4F534A) + data
        + struct.pack("<II", len(GLTF_BUFFER), 0x004E4942) + GLTF_BUFFER
    )


class StlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.images = root / "images" / "posts_images"
        for name, value in (
            ("ROOT", root),
            ("IMAGES_DIR", self.images),
            ("DRAFT_DIR", root / "drafts"),
            ("POST_DIR", root / "post"),
        ):
            patcher = patch.object(server, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        server.POST_DIR.mkdir()
        self.client = server.app.test_client()

    def upload(self, content=ASCII_STL, name="triangle.stl", slug="test-post", endpoint="/api/upload-model", assets=None):
        response = self.client.post(
            endpoint,
            data={
                "slug": slug, "file": (io.BytesIO(content), name),
                "assets": [(io.BytesIO(data), path) for path, data in (assets or {}).items()],
            },
        )
        response.request.input_stream.close()
        return response

    def test_upload_and_serve_ascii_and_binary_without_overwriting(self):
        urls = []
        for content in (ASCII_STL, BINARY_STL):
            response = self.upload(content, name="TRIANGLE.STL")
            self.assertEqual(response.status_code, 200)
            url = response.json["url"]
            urls.append(url)
            with self.client.get(url.removeprefix("..")) as model:
                self.assertEqual(model.status_code, 200)
                self.assertEqual(model.data, content)
        self.assertNotEqual(*urls)

    def test_obj_upload_preserves_extension_and_contents(self):
        response = self.upload(OBJ_MODEL, name="MODEL.OBJ")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json["url"].endswith(".obj"))
        with self.client.get(response.json["url"].removeprefix("..")) as model:
            self.assertEqual(model.data, OBJ_MODEL)

    def test_legacy_stl_endpoint(self):
        self.assertEqual(self.upload(endpoint="/api/upload-stl").status_code, 200)

    def test_usdz_upload_preserves_extension_and_archive(self):
        content = make_usdz()
        response = self.upload(content, name="MODEL.USDZ")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json["url"].endswith(".usdz"))
        with self.client.get(response.json["url"].removeprefix("..")) as model:
            self.assertEqual(model.status_code, 200)
            self.assertEqual(model.data, content)
        with self.client.get("/") as page:
            self.assertIn(b'accept=".stl,.obj,.usdz,.gltf,.glb"', page.data)

    def test_self_contained_gltf_and_glb(self):
        for name, data in (("MODEL.GLTF", json.dumps(gltf_document()).encode()), ("MODEL.GLB", make_glb())):
            with self.subTest(name=name):
                response = self.upload(data, name=name)
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.json["url"].endswith(Path(name).suffix.lower()))
                with self.client.get(response.json["url"].removeprefix("..")) as model:
                    self.assertEqual(model.status_code, 200)
                    self.assertEqual(model.data, data)

    def test_external_gltf_assets_are_isolated_and_keep_relative_paths(self):
        document = gltf_document("./buffers/triangle%20data.bin")
        document["images"] = [{"uri": "textures/pixel.png"}]
        assets = {"buffers/triangle data.bin": GLTF_BUFFER, "textures/pixel.png": b"texture"}
        urls = []
        for _ in range(2):
            response = self.upload(json.dumps(document).encode(), name="triangle.gltf", assets=assets)
            self.assertEqual(response.status_code, 200, response.json)
            urls.append(response.json["url"])
            folder = urls[-1].removeprefix("..").rsplit("/", 1)[0]
            for path, data in assets.items():
                with self.client.get(folder + "/" + path) as asset:
                    self.assertEqual(asset.status_code, 200)
                    self.assertEqual(asset.data, data)
        self.assertNotEqual(*urls)

    def test_glb_with_external_texture(self):
        document = gltf_document()
        document["images"] = [{"uri": "textures/pixel.png"}]
        response = self.upload(
            make_glb(document), name="triangle.glb", assets={"textures/pixel.png": b"texture"},
        )
        self.assertEqual(response.status_code, 200, response.json)

    def test_missing_or_unsafe_gltf_assets(self):
        for uri in ("missing.bin", "../outside.bin", "%2e%2e/outside.bin",
                    "https://example.com/model.bin", "/absolute.bin", "file.html", "bad\\file.bin"):
            with self.subTest(uri=uri):
                response = self.upload(json.dumps(gltf_document(uri)).encode(), name="model.gltf")
                self.assertEqual(response.status_code, 400, response.json)
        self.assertFalse(self.images.exists())

    def test_invalid_gltf_and_glb(self):
        for name, data in (
            ("model.gltf", b"not JSON"), ("model.gltf", b"null"),
            ("model.gltf", b'{"asset": {"version": "1.0"}}'),
            ("model.gltf", b'{"asset": {"version": "2.0"}, "buffers": "invalid"}'),
            ("model.glb", b"not GLB"),
        ):
            with self.subTest(name=name, data=data):
                self.assertEqual(self.upload(data, name=name).status_code, 400)
        self.assertFalse(self.images.exists())

    def test_gltf_asset_total_size_limit(self):
        response = self.upload(
            json.dumps(gltf_document("model.bin")).encode(), name="model.gltf",
            assets={"model.bin": b"x" * (25 * 1024 * 1024)},
        )
        self.assertEqual(response.status_code, 413)
        self.assertIn("25 MB", response.json["error"])
        self.assertFalse(self.images.exists())

    def test_invalid_uploads(self):
        for kwargs in ({"content": b""}, {"name": "file.html"}, {"slug": ""}):
            with self.subTest(kwargs=kwargs):
                self.assertEqual(self.upload(**kwargs).status_code, 400)
        self.assertEqual(self.client.post("/api/upload-model", data={"slug": "test"}).status_code, 400)
        self.assertFalse(self.images.exists())

    def test_oversized_upload(self):
        response = self.upload(b"x" * (25 * 1024 * 1024 + 1))
        self.assertEqual(response.status_code, 413)
        self.assertIn("25 MB", response.json["error"])
        self.assertFalse(self.images.exists())

    def test_preview_assets_match_published_paths(self):
        for filename in ("stl-viewer.html", "stl-viewer.js", "usdc-parser.js"):
            with self.client.get("/tools/postmaker/static/" + filename) as response:
                self.assertEqual(response.status_code, 200)
        with self.client.get("/") as response:
            self.assertIn(b'id="btnStl"', response.data)
            self.assertIn(b'id="stlDialog"', response.data)

    def test_viewer_survives_publish_and_extract(self):
        url = self.upload().json["url"]
        content = (
            '<div contenteditable="false"><iframe loading="lazy" title="Triangle" '
            f'src="../tools/postmaker/static/stl-viewer.html?model={url}"></iframe>'
            f'<a href="{url}">Download STL</a></div>'
        )
        response = self.client.post("/api/save", json={
            "mode": "edit", "title": "Triangle", "slug": "triangle",
            "date": "2026-10-17", "content": content,
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get("/api/posts/triangle").json["content"], content)
        published = (server.POST_DIR / "triangle.html").read_text()
        self.assertIn(content, published)
        self.assertNotIn("cdn.jsdelivr.net", published)
        self.assertEqual(urlsplit(url).scheme, "")

    def test_obj_viewer_survives_publish_and_extract(self):
        url = self.upload(OBJ_MODEL, name="mesh.obj").json["url"]
        content = (
            '<iframe loading="lazy" title="OBJ model" '
            f'src="../tools/postmaker/static/stl-viewer.html?model={url}"></iframe>'
        )
        response = self.client.post("/api/save", json={
            "mode": "edit", "title": "OBJ", "slug": "obj",
            "date": "2026-10-17", "content": content,
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get("/api/posts/obj").json["content"], content)

    def test_usdz_viewer_survives_publish_and_extract(self):
        url = self.upload(make_usdz(), name="mesh.usdz").json["url"]
        content = (
            '<iframe loading="lazy" title="USDZ model" '
            f'src="../tools/postmaker/static/stl-viewer.html?model={url}"></iframe>'
        )
        response = self.client.post("/api/save", json={
            "mode": "edit", "title": "USDZ", "slug": "usdz",
            "date": "2026-10-17", "content": content,
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get("/api/posts/usdz").json["content"], content)

    def test_gltf_viewer_survives_publish_and_extract(self):
        for name, data in (("model.gltf", json.dumps(gltf_document()).encode()), ("model.glb", make_glb())):
            with self.subTest(name=name):
                url = self.upload(data, name=name).json["url"]
                content = (
                    '<iframe loading="lazy" title="glTF model" '
                    f'src="../tools/postmaker/static/stl-viewer.html?model={url}"></iframe>'
                )
                response = self.client.post("/api/save", json={
                    "mode": "edit", "title": "glTF", "slug": "gltf",
                    "date": "2026-10-17", "content": content,
                })
                self.assertEqual(response.status_code, 200)
                self.assertEqual(self.client.get("/api/posts/gltf").json["content"], content)


if __name__ == "__main__":
    unittest.main()
