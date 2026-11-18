"""Print one local Priority EDM entity and immediate navigation targets as JSON."""
import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

EDM = "{http://docs.oasis-open.org/odata/ns/edm}"


def extract(path, entity, fields=None):
    root = ET.parse(path).getroot()
    schemas = list(root.iter(EDM + "Schema"))
    # GetMetadataFor may return a standalone, unnamespaced EntityType fragment.
    entities = {}
    aliases = {}
    for schema in schemas:
        namespace = schema.get("Namespace", "")
        alias = schema.get("Alias")
        for item in schema.findall(EDM + "EntityType"):
            full = namespace + "." + item.get("Name", "")
            entities[full] = item
            if alias:
                aliases[alias + "." + item.get("Name", "")] = full
    if not schemas:
        for item in root.iter():
            if item.tag.split("}")[-1] == "EntityType":
                entities[item.get("Name")] = item

    def resolve(name):
        name = aliases.get(name, name)
        if name in entities:
            return name
        matches = [key for key in entities if key.rsplit(".", 1)[-1] == name]
        if len(matches) != 1:
            raise ValueError(f"Entity {name!r} missing or ambiguous")
        return matches[0]

    selected = resolve(entity)

    def describe(name, field_filter=None):
        item = entities[name]
        ns = EDM if item.tag.startswith(EDM) else ""
        key_node = item.find(ns + "Key")
        keys = [] if key_node is None else [x.get("Name") for x in key_node]
        props = []
        for prop in item.findall(ns + "Property"):
            if field_filter and prop.get("Name") not in field_filter and prop.get("Name") not in keys:
                continue
            data = dict(prop.attrib)
            annotations = [dict(a.attrib) for a in prop.findall(ns + "Annotation")]
            if annotations:
                data["annotations"] = annotations
            props.append(data)
        return {"entity": name, "keys": keys, "fields": props,
                "navigation": [dict(n.attrib) for n in item.findall(ns + "NavigationProperty")]}

    result = describe(selected, fields)
    children = []
    seen = {selected}
    for navigation in result["navigation"]:
        target = navigation.get("Type", "")
        if target.startswith("Collection(") and target.endswith(")"):
            target = target[11:-1]
        try:
            target = resolve(target)
        except ValueError:
            children.append({"entity": target, "unresolved": True})
            continue
        if target not in seen:
            children.append(describe(target, fields))
            seen.add(target)
    result["subforms"] = children
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("metadata", type=Path)
    parser.add_argument("entity")
    parser.add_argument("--fields", help="Comma-separated fields; keys always retained")
    args = parser.parse_args()
    fields = {f.strip() for f in args.fields.split(",") if f.strip()} if args.fields else None
    try:
        result = extract(args.metadata, args.entity, fields)
    except (OSError, ET.ParseError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
