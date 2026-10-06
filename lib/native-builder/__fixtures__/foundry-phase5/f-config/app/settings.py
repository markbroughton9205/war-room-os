import yaml


def load_settings(text):
    """Parses the settings text into a dict."""
    return yaml.load(text)
