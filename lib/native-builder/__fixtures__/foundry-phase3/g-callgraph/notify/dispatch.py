from notify.style import emphasize


def send_notice(user, text):
    message = emphasize(text)
    return "sent to %s: %s" % (user, message)
