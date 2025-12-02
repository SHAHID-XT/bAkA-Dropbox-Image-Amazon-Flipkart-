import requests
import webbrowser
import json
import os


class DropboxOAuth:
    AUTH_URL = "https://www.dropbox.com/oauth2/authorize"
    TOKEN_URL = "https://api.dropbox.com/oauth2/token"

    def __init__(self, app_key, app_secret, redirect_uri, state="boka", token_file= "tokens.json"):
        self.app_key = app_key
        self.app_secret = app_secret
        self.redirect_uri = redirect_uri
        self.state = state
        self.token_file = token_file

    def open_authorization_page(self):
        url = (
            f"{self.AUTH_URL}?client_id={self.app_key}"
            f"&response_type=code"
            f"&token_access_type=offline"
            f"&redirect_uri={self.redirect_uri}"
            f"&state={self.state}"
        )
        print("Opening browser for authorization...")
        webbrowser.open(url)
        print("After approval, copy the 'code=' value from the URL and paste here.")

    
    def exchange_code_for_tokens(self, code):
        data = {
            "code": code,
            "grant_type": "authorization_code",
            "client_id": self.app_key,
            "client_secret": self.app_secret,
            "redirect_uri": self.redirect_uri,
        }

        response = requests.post(self.TOKEN_URL, data=data)
        if response.status_code != 200:
            raise Exception(f"Error getting tokens: {response.text}")

        tokens = response.json()
        self.save_tokens(tokens)
        print("\n✅ Tokens received and saved successfully!\n")
        return tokens


    def refresh_access_token(self):
        tokens = self.load_tokens()

        if "refresh_token" not in tokens:
            raise Exception("Refresh token not available. Get authorization first.")

        data = {
            "refresh_token": tokens["refresh_token"],
            "grant_type": "refresh_token",
            "client_id": self.app_key,
            "client_secret": self.app_secret,
        }

        response = requests.post(self.TOKEN_URL, data=data)
        if response.status_code != 200:
            raise Exception(f"Error refreshing token: {response.text}")

        new_tokens = response.json()

        # Only access_token changes; refresh_token stays same
        tokens["access_token"] = new_tokens["access_token"]
        tokens["expires_in"] = new_tokens.get("expires_in", None)

        self.save_tokens(tokens)

        print("\n🔄 Access token refreshed successfully!\n")
        return tokens

    
    def save_tokens(self, tokens):
        with open(self.token_file, "w") as f:
            json.dump(tokens, f, indent=4)

   
    def load_tokens(self):
        if not os.path.exists(self.token_file):
            raise FileNotFoundError("Token file not found. Run authorization flow first.")
        with open(self.token_file, "r") as f:
            return json.load(f)



if __name__ == "__main__":

    APP_KEY = "[REDACTED]" 
    APP_SECRET = "[REDACTED]"
    REDIRECT_URI = "http://localhost"
    STATE = "boka"

    dropbox = DropboxOAuth(APP_KEY, APP_SECRET, REDIRECT_URI, STATE)

    dropbox.open_authorization_page()

    # 2. After getting ?code=XYZ, paste it here:
    auth_code = input("PASTE_AUTH_CODE_HERE: ").strip()
    dropbox.exchange_code_for_tokens(auth_code)

    print(dropbox.refresh_access_token())
