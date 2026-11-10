"""SQLite locally, PostgreSQL when DATABASE_URL is configured.

The small adapter binds existing positional/named parameters using psycopg;
SQL statements themselves use syntax supported by both databases.
"""
import re
import sqlite3
from urllib.parse import parse_qs, urlsplit

try:
    import psycopg
except ImportError:
    psycopg = None

IntegrityErrors = (sqlite3.IntegrityError,) + ((psycopg.IntegrityError,) if psycopg else ())
TOKENS = re.compile(r"'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"|\?|(?<!:):([A-Za-z_][A-Za-z_0-9]*)")


def is_postgres(address):
    return str(address).startswith(('postgres://', 'postgresql://'))


class Row(dict):
    def __getitem__(self, key):
        return list(self.values())[key] if isinstance(key, int) else super().__getitem__(key)


def row_factory(cursor):
    names = [column.name for column in cursor.description] if cursor.description else []
    return lambda values: Row(zip(names, values))


def bind_parameters(sql):
    def token(match):
        value = match.group()
        if value == '?':
            return '%s'
        return '%(' + match.group(1) + ')s' if match.group(1) else value
    return TOKENS.sub(token, sql.replace('%', '%%'))


class PostgresConnection:
    def __init__(self, address):
        if psycopg is None:
            raise RuntimeError('Install backend/requirements.txt to use PostgreSQL.')
        options = parse_qs(urlsplit(address).query)
        tls = {}
        if options.get('sslmode') == ['verify-full'] and 'sslrootcert' not in options:
            import certifi
            tls['sslrootcert'] = certifi.where()
        self.connection = psycopg.connect(address, autocommit=True, row_factory=row_factory,
                                          connect_timeout=10, application_name='carryon', **tls)

    def execute(self, sql, parameters=None):
        statement = sql.strip()
        if statement.upper() == 'BEGIN IMMEDIATE':
            # Serialize short ticket/sign-in transactions across web workers.
            self.connection.execute('BEGIN')
            self.connection.execute('SELECT pg_advisory_xact_lock(49720261110)')
            return self.connection.execute('SELECT 1')
        if re.match(r'^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b', statement, re.I):
            if self.connection.info.transaction_status == psycopg.pq.TransactionStatus.IDLE:
                self.connection.execute('BEGIN')
        return self.connection.execute(bind_parameters(sql) if parameters is not None else sql, parameters)

    def executescript(self, script):
        # Schema scripts contain plain DDL, with no procedural blocks or semicolons in strings.
        for statement in script.split(';'):
            if statement.strip():
                self.execute(statement)

    def commit(self):
        self.connection.commit()

    def rollback(self):
        self.connection.rollback()

    def close(self):
        self.connection.close()

    def __enter__(self):
        return self

    def __exit__(self, kind, value, traceback):
        try:
            self.rollback() if kind else self.commit()
        finally:
            self.close()


def connect_database(address):
    if is_postgres(address):
        return PostgresConnection(address)
    connection = sqlite3.connect(address, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA foreign_keys = ON')
    connection.execute('PRAGMA busy_timeout = 10000')
    return connection


def table_columns(db, table):
    if not re.fullmatch('[a-z_]+', table):
        raise ValueError('Invalid internal table name.')
    if isinstance(db, PostgresConnection):
        rows = db.execute('SELECT column_name AS name FROM information_schema.columns '
                          'WHERE table_schema=current_schema() AND table_name=?', (table,))
    else:
        rows = db.execute('PRAGMA table_info(' + table + ')')
    return {row['name'] for row in rows}
