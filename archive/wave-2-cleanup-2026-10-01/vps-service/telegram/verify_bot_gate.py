"""
Regression check for the BOT-SUBSCRIPTION-GATE logic in
vps-service/telegram/telegram_interactive_bot.py.

Run: python3 vps-service/telegram/verify_bot_gate.py

Every Telegram send is intercepted, so nothing is actually messaged and no
database is touched. The point is the decision table: a site outage must never
look like "not linked", and a failed token mint must never produce a dead link.
"""
import importlib.util, os, sys, types

# Stub `requests` if it is not installed in this interpreter.
try:
    import requests  # noqa: F401
except ImportError:
    requests = types.ModuleType('requests')
    class _Resp:
        def __init__(self, status_code=200, payload=None, text=''):
            self.status_code = status_code
            self.ok = 200 <= status_code < 300
            self._payload = payload
            self.text = text
        def json(self):
            return self._payload
    requests.Response = _Resp
    requests.get = lambda *a, **k: _Resp()
    requests.post = lambda *a, **k: _Resp()
    sys.modules['requests'] = requests

BOT = os.path.expanduser('~/my_apps/GLMinvestment/vps-service/telegram/telegram_interactive_bot.py')
spec = importlib.util.spec_from_file_location('bot', BOT)
bot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bot)

failures = 0
def check(label, cond, extra=None):
    global failures
    if cond:
        print(f'  PASS  {label}')
    else:
        failures += 1
        print(f'  FAIL  {label}', '' if extra is None else extra)

# Capture every outgoing message instead of hitting Telegram.
sent = []
real_check_subscription = bot.check_subscription
def fake_send_message(chat_id, text, reply_markup=None, parse_mode='HTML'):
    sent.append({'text': text, 'kb': reply_markup})
bot.send_message = fake_send_message

class Resp:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self._payload = payload if payload is not None else {}
        self.text = str(self._payload)
    def json(self):
        return self._payload

print('1) check_subscription must distinguish "not linked" from "site down"')

def _call_with(fake_get):
    old = bot.requests.get
    bot.requests.get = fake_get
    try:
        return bot.check_subscription(12345)
    finally:
        bot.requests.get = old

def with_secret(fn):
    old = bot.BOT_API_SECRET
    bot.BOT_API_SECRET = 's3cret'
    try:
        return fn()
    finally:
        bot.BOT_API_SECRET = old

def boom(*a, **k):
    raise RuntimeError('connection refused')
r = with_secret(lambda: _call_with(boom))
check('network error -> _error (NOT linked:false)', r.get('_error') is True, r)
check('network error does not look unlinked', not r.get('linked'), r)
check('network error is not fail-open', not r.get('_fail_open'), r)

def http500(*a, **k):
    return Resp(500, {'success': False, 'error': 'internal_error'})
r = with_secret(lambda: _call_with(http500))
check('HTTP 500 -> _error', r.get('_error') is True, r)
check('HTTP 500 not fail-open', not r.get('_fail_open'), r)

def ok_paid(*a, **k):
    return Resp(200, {'success': True, 'linked': True, 'is_paid': True, 'is_trial_active': False})
r = with_secret(lambda: _call_with(ok_paid))
check('200 paid -> linked + is_paid', r.get('linked') is True and r.get('is_paid') is True, r)
check('200 paid -> no _error flag', '_error' not in r, r)

def unlinked(*a, **k):
    return Resp(200, {'linked': False})
r = with_secret(lambda: _call_with(unlinked))
check('200 unlinked -> linked:false and NO _error', r.get('linked') is False and '_error' not in r, r)

print('2) is_user_allowed')
check('paid -> allowed', bot.is_user_allowed({'linked': True, 'is_paid': True}) is True)
check('trial -> allowed', bot.is_user_allowed({'linked': True, 'is_trial_active': True}) is True)
check('free, expired trial -> blocked',
      bot.is_user_allowed({'linked': True, 'is_paid': False, 'is_trial_active': False}) is False)
check('not linked -> blocked', bot.is_user_allowed({'linked': False}) is False)

print('3) handle_start never tells a linked user to re-link when the site is down')
sent.clear()
bot.check_subscription = lambda chat_id: {'_error': True, 'error': 'http_500'}
bot.handle_start(1, 'ahmed')
check('one message sent', len(sent) == 1, sent)
check('message is the temporary-outage notice', 'مشكلة مؤقتة' in sent[0]['text'], sent[0]['text'][:80])
check('message does NOT ask to link the account', 'اربط حسابك' not in sent[0]['text'])
check('no link button offered', not sent[0]['kb'], sent[0]['kb'])

print('4) handle_start for a genuinely unlinked user still asks to link')
sent.clear()
bot.check_subscription = lambda chat_id: {'linked': False}
bot.generate_link_token = lambda chat_id, username='': {'link_url': 'https://invist.m2y.net/?bot_link=abc'}
bot.handle_start(1, 'ahmed')
check('one message sent', len(sent) == 1, sent)
check('link prompt shown', 'ربط' in sent[0]['text'], sent[0]['text'][:80])
label = sent[0]['kb']['inline_keyboard'][0][0]['text']
check('button label asks to link', 'ربط' in label, label)
url = sent[0]['kb']['inline_keyboard'][0][0]['url']
check('button carries a real token', url.endswith('?bot_link=abc'), url)

print('5) link prompt must not ship a dead (tokenless) button')
sent.clear()
bot.check_subscription = lambda chat_id: {'linked': False}
bot.generate_link_token = lambda chat_id, username='': {}   # site refused to mint
bot._send_link_prompt(1, 'ahmed')
url = sent[0]['kb']['inline_keyboard'][0][0]['url']
check('fallback button points at the platform root', url == 'https://invist.m2y.net', url)
check('no empty bot_link query is emitted', 'bot_link' not in url, url)
check('user is told to come back to /start', '/start' in sent[0]['text'], sent[0]['text'][:120])

print('6) fail-open when BOT_API_SECRET is missing')
bot.check_subscription = real_check_subscription
bot.BOT_API_SECRET = ''
r = bot.check_subscription(1)
check('_fail_open set', r.get('_fail_open') is True, r)
check('fail-open is treated as paid', r.get('is_paid') is True, r)

print()
print('ALL CHECKS PASSED' if failures == 0 else f'{failures} CHECK(S) FAILED')
sys.exit(0 if failures == 0 else 1)
