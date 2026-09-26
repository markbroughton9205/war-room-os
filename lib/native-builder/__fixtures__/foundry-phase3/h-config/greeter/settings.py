import os


def greeting_style():
    return os.environ.get("GREETING_STYLE", "plain")


def shouting_enabled():
    return os.environ.get("ENABLE_SHOUTING", "false") == "true"


def smtp_password():
    return os.environ.get("SMTP_PASSWORD")
