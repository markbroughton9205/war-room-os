import csv
import os

DATA = os.path.join(os.path.dirname(__file__), "..", "data", "prices.csv")


def load_prices(path=DATA):
    """Returns {product name: unit price} from the catalog file."""
    prices = {}
    with open(path, newline="") as handle:
        for row in csv.DictReader(handle):
            prices[row["product"]] = float(row["price"])
    return prices
