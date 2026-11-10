#!/bin/sh
set -eu
exec gunicorn --config gunicorn.conf.py wsgi:app
