from django.utils.crypto import get_random_string

_PASSWORD_CHARS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%"


def generate_temp_password(length=14):
    return get_random_string(length=length, allowed_chars=_PASSWORD_CHARS)
