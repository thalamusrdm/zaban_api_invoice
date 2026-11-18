"""Compare two Priority report exports at a verified, unique grain."""

import argparse
from collections import defaultdict
import csv
from decimal import Decimal, localcontext
import json
from pathlib import Path
import re
import sys


def decimal_value(value):
    value = value.strip()
    if len(value) > 48 or not re.fullmatch(r"[+-]?[0-9]+(?:\.[0-9]+)?", value):
        raise ValueError("expected a plain decimal using a dot")
    return Decimal(value)


def read_export(path, keys, amount, delimiter):
    grouped = defaultdict(list)
    with path.open(encoding="utf-8-sig", newline="") as file:
        rows = csv.reader(file, delimiter=delimiter, strict=True)
        header = next(rows, [])
        if not header or len(set(header)) != len(header) or any(not x.strip() for x in header):
            raise ValueError(f"{path.name}: missing, blank or duplicate header")
        if absent := set([*keys, amount]) - set(header):
            raise ValueError(f"{path.name}: missing headers: {', '.join(sorted(absent))}")
        positions = [header.index(key) for key in keys]
        value_column = header.index(amount)
        for record, values in enumerate(rows, start=2):
            if len(values) != len(header):
                raise ValueError(f"{path.name}: wrong field count at record {record}")
            key = tuple(values[i] for i in positions)
            if any(not value.strip() for value in key):
                raise ValueError(f"{path.name}: missing key at record {record}")
            try:
                value = decimal_value(values[value_column])
            except ValueError as error:
                raise ValueError(f"{path.name}: record {record}: {error}") from error
            grouped[key].append((record, value))
    return grouped


def compare(report, source, tolerance, limit):
    labels = ("exact", "within_tolerance", "value_mismatch", "report_only", "source_only", "duplicate_key")
    results = {label: {"keys": 0, "report_rows": 0, "source_rows": 0, "examples": []} for label in labels}
    with localcontext() as ctx:
        ctx.prec = 100  # Enough for subtraction across the supported decimal lengths.
        for key in dict.fromkeys((*report, *source)):
            left, right = report.get(key, ()), source.get(key, ())
            delta = None
            if len(left) > 1 or len(right) > 1:
                label = "duplicate_key"
            elif not right:
                label = "report_only"
            elif not left:
                label = "source_only"
            else:
                delta = left[0][1] - right[0][1]
                label = "exact" if delta == 0 else "within_tolerance" if abs(delta) <= tolerance else "value_mismatch"
            category = results[label]
            category["keys"] += 1
            category["report_rows"] += len(left)
            category["source_rows"] += len(right)
            if label != "exact" and len(category["examples"]) < limit:
                example = {"report_records": [row for row, _ in left[:8]],
                           "source_records": [row for row, _ in right[:8]],
                           "report_count": len(left), "source_count": len(right)}
                if delta is not None:
                    example["delta"] = format(delta, "f")
                category["examples"].append(example)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("source", type=Path)
    parser.add_argument("--key", required=True, help="Comma-separated exact header names")
    parser.add_argument("--report-value", required=True)
    parser.add_argument("--source-value", required=True)
    parser.add_argument("--delimiter", choices=("comma", "tab", "semicolon"), default="comma")
    parser.add_argument("--tolerance", default="0")
    parser.add_argument("--examples", type=int, default=12)
    args = parser.parse_args()
    keys = args.key.split(",")
    if any(not key.strip() for key in keys) or len(set(keys)) != len(keys) or args.examples < 0:
        parser.error("Use distinct nonblank key headers and a nonnegative example limit")
    if args.report_value in keys or args.source_value in keys:
        parser.error("Value columns must not be key columns")
    delimiter = {"comma": ",", "tab": "\t", "semicolon": ";"}[args.delimiter]
    try:
        tolerance = decimal_value(args.tolerance)
        if tolerance < 0:
            raise ValueError("tolerance must be nonnegative")
        report = read_export(args.report, keys, args.report_value, delimiter)
        source = read_export(args.source, keys, args.source_value, delimiter)
        categories = compare(report, source, tolerance, args.examples)
    except (OSError, ValueError, csv.Error) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps({"tolerance": str(tolerance), "categories": categories}, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
