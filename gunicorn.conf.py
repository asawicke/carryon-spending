"""Small-instance production server; API timeouts include external fare searches."""
import os

bind = '0.0.0.0:' + os.environ.get('PORT', '8000')
workers = 1
worker_class = 'gthread'
threads = 4
timeout = 120
graceful_timeout = 30
max_requests = 1500
max_requests_jitter = 100
# Query strings can contain OAuth/provider information; log only the URL path.
accesslog = '-'
access_log_format = '%(h)s %(t)s "%(m)s %(U)s %(H)s" %(s)s %(b)s'
errorlog = '-'
capture_output = True
