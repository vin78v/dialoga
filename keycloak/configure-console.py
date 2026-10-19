#!/usr/bin/env python3
"""Apply the checked-in browser client to an existing local realm without resetting it."""
import json
import os
from pathlib import Path
import urllib.parse
import urllib.request

base = os.environ.get('DIALOGA_KEYCLOAK_URL', 'http://localhost:8081').rstrip('/')
username = os.environ['DIALOGA_KEYCLOAK_ADMIN']
password = os.environ['DIALOGA_KEYCLOAK_ADMIN_PASSWORD']
realm = json.loads(Path(__file__).with_name('realm-dialoga.json').read_text())
client = next(c for c in realm['clients'] if c['clientId'] == 'dialoga-console')
body = urllib.parse.urlencode(dict(grant_type='password', client_id='admin-cli', username=username, password=password)).encode()
with urllib.request.urlopen(base + '/realms/master/protocol/openid-connect/token', body, timeout=15) as response:
    token = json.load(response)['access_token']

def request(path, method='GET', payload=None):
    req = urllib.request.Request(base + '/admin/realms/' + realm['realm'] + '/' + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method=method)
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response) if response.status == 200 else None

existing = request('clients?' + urllib.parse.urlencode({'clientId': client['clientId']}))
if existing:
    current = request('clients/' + existing[0]['id'])
    current.update(client)
    request('clients/' + current['id'], 'PUT', current)
else:
    request('clients', 'POST', client)
print('Client browser dialoga-console configurato.')
