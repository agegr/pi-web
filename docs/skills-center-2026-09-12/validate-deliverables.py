"""Validate this documentation bundle without running the product or installing dependencies."""
from html.parser import HTMLParser
from pathlib import Path
import hashlib
import json
import re
import struct
from urllib.parse import unquote, urlsplit


BASE = Path(__file__).resolve().parent


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.ids = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            self.ids.add(attrs["id"])
        for key in ("href", "src"):
            if key in attrs:
                self.links.append(attrs[key])


def main():
    errors = []
    checked_links = 0
    files = list(BASE.glob("*.md")) + list(BASE.glob("*.html"))
    for file in files:
        content = file.read_text(encoding="utf-8")
        if file.suffix == ".html":
            parsed = References()
            parsed.feed(content)
            links = parsed.links
        else:
            links = re.findall(r"\[[^\]]*\]\(([^)]+)\)", content)
        for raw in links:
            ref = urlsplit(raw.strip("<>"))
            if ref.scheme or ref.netloc:
                continue
            target = (file.parent / unquote(ref.path)).resolve() if ref.path else file
            checked_links += 1
            if not target.exists():
                errors.append(f"Broken link: {file.name} -> {raw}")
            elif ref.fragment and target.suffix == ".html":
                target_parser = References()
                target_parser.feed(target.read_text(encoding="utf-8"))
                if ref.fragment not in target_parser.ids:
                    errors.append(f"Missing HTML anchor: {raw}")

    spec = (BASE / "specs.md").read_text(encoding="utf-8")
    features = re.findall(r"^## (F\d{2}) ", spec, flags=re.M)
    if features != [f"F{i:02}" for i in range(1, 23)]:
        errors.append("Feature headings are not exactly F01-F22.")
    cases = re.findall(r"^- (F\d{2}-[A-Z])：", spec, flags=re.M)
    if len(cases) != len(set(cases)):
        errors.append("Duplicate acceptance IDs.")
    for feature in features:
        if sum(case.startswith(feature + "-") for case in cases) < 3:
            errors.append(f"Fewer than three acceptance cases: {feature}")

    manifest = json.loads((BASE / "screen-prompts.json").read_text(encoding="utf-8"))
    screens = manifest["screens"]
    if sorted(screen["id"] for screen in screens) != [f"{i:02}" for i in range(13)]:
        errors.append("Expected thirteen distinct final screens, 00-12.")
    dimensions = []
    revised_original_screens = 0
    for screen in screens:
        path = BASE / "screens" / screen["file"]
        if not path.exists():
            errors.append(f"Missing image: {path.name}")
            continue
        header = path.read_bytes()[:24]
        if header[:8] != b"\x89PNG\r\n\x1a\n":
            errors.append(f"Invalid PNG header: {path.name}")
            continue
        width, height = struct.unpack(">II", header[16:24])
        dimensions.append({"file": path.name, "width": width, "height": height})
        previous = BASE / "references" / "v1" / path.name
        if previous.exists():
            if hashlib.sha256(previous.read_bytes()).digest() == hashlib.sha256(path.read_bytes()).digest():
                errors.append(f"Original screen was not revised: {path.name}")
            else:
                revised_original_screens += 1
        if screen["viewport"] == "desktop" and width <= height:
            errors.append(f"Desktop image is not landscape: {path.name}")
        if screen["viewport"] == "mobile" and height <= width:
            errors.append(f"Mobile image is not portrait: {path.name}")
        references = list(screen["references"])
        for revision in screen.get("revisions", []):
            references.extend(revision["references"])
        for reference in references:
            if not (BASE / reference).resolve().exists():
                errors.append(f"Missing prompt reference: {reference}")

    taxonomy = json.loads((BASE / "taxonomy-proposal.json").read_text(encoding="utf-8"))
    domains = taxonomy["domains"]
    expected_domains = ["computing", "finance", "philosophy", "psychology", "metaphysics"]
    if [domain["id"] for domain in domains] != expected_domains:
        errors.append("Expected the five user-requested domains in the agreed order.")
    categories = [category for domain in domains for category in domain["categories"]]
    if len({category["id"] for category in categories}) != len(categories):
        errors.append("Duplicate taxonomy category IDs.")
    api_contract = (BASE / "api-spec.md").read_text(encoding="utf-8")
    for category in categories:
        if category["id"] + " → " + category["label"] not in api_contract:
            errors.append(f"Category does not match API contract: {category['id']}")

    result = {
        "status": "PASS" if not errors else "FAIL",
        "documentationFiles": len(files),
        "localLinksChecked": checked_links,
        "featureSpecs": len(features),
        "acceptanceCases": len(cases),
        "domains": len(domains),
        "categoryDirections": len(categories),
        "revisedOriginalScreens": revised_original_screens,
        "screens": dimensions,
        "errors": errors,
        "scope": "Document links, feature coverage and asset presence/shape only; no product tests.",
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(bool(errors))


if __name__ == "__main__":
    main()
