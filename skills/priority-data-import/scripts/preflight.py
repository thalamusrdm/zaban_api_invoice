"""Summarize exact-key duplicates in mapped UTF-8 CSV/TSV without accessing Priority."""

import argparse
from collections import defaultdict
import csv
import json
from pathlib import Path
import sys


def scan(path, keys, delimiter, payload):
    groups = defaultdict(list)
    missing = []
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.reader(source, delimiter=delimiter, strict=True)
        header = next(reader, [])
        if not header or any(not name.strip() for name in header) or len(set(header)) != len(header):
            raise ValueError(f"{path.name}: missing, blank or duplicate header")
        if absent := set(keys) - set(header):
            raise ValueError(f"{path.name}: missing key headers: {', '.join(sorted(absent))}")
        key_columns = [header.index(name) for name in keys]
        for record, values in enumerate(reader, start=2):
            if len(values) != len(header):
                raise ValueError(f"{path.name}: wrong field count at record {record}")
            key = tuple(values[i] for i in key_columns)
            if any(not value.strip() for value in key):
                missing.append(record)
            else:
                groups[key].append((record, tuple(values) if payload else ()))
    return groups, missing


def summarize(source, existing, keys, delimiter, examples):
    groups, missing = scan(source, keys, delimiter, payload=True)
    targets, invalid_targets = scan(existing, keys, delimiter, payload=False) if existing else ({}, [])
    if invalid_targets:
        raise ValueError(f"Existing extract has {len(invalid_targets)} rows with missing keys")
    labels = ("missing_key", "identical_input", "conflicting_input", "ambiguous_target",
              "matched_target", "unmatched_in_extract", "target_not_checked")
    report = {label: {"rows": 0, "groups": 0, "example_records": []} for label in labels}

    def add(label, records):
        result = report[label]
        result["rows"] += len(records)
        result["groups"] += 1
        room = examples - len(result["example_records"])
        if room > 0:
            result["example_records"].extend(records[:room])

    for record in missing:
        add("missing_key", [record])
    for key, group in groups.items():
        records = [record for record, _ in group]
        if len(group) > 1:
            label = "identical_input" if len({values for _, values in group}) == 1 else "conflicting_input"
        elif existing is None:
            label = "target_not_checked"
        else:
            hits = len(targets.get(key, ()))
            label = "ambiguous_target" if hits > 1 else "matched_target" if hits else "unmatched_in_extract"
        add(label, records)
    return {"input_rows": sum(result["rows"] for result in report.values()),
            "target_extract_supplied": existing is not None, "categories": report}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--key", required=True, help="Exact header names, comma separated")
    parser.add_argument("--existing", type=Path, help="Optional existing key extract")
    parser.add_argument("--delimiter", choices=("comma", "tab", "semicolon"), default="comma")
    parser.add_argument("--examples", type=int, default=20)
    args = parser.parse_args()
    keys = args.key.split(",")
    if any(not key.strip() for key in keys) or len(keys) != len(set(keys)) or args.examples < 0:
        parser.error("Use distinct, nonblank key headers and a nonnegative example limit")
    delimiter = {"comma": ",", "tab": "\t", "semicolon": ";"}[args.delimiter]
    try:
        report = summarize(args.source, args.existing, keys, delimiter, args.examples)
    except (OSError, ValueError, csv.Error) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(report, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
