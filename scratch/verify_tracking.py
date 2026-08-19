import urllib.request
import json
import urllib.parse

def verify_tracking():
    try:
        url = "http://127.0.0.1:8010/api/predictions/tracking/verify"
        req = urllib.request.Request(url, method='POST')
        with urllib.request.urlopen(req) as res:
            print("Response:", res.read().decode('utf-8'))
    except Exception as e:
        print(f"Error: {e}")

verify_tracking()
