from flask import Flask

app = Flask(__name__)


@app.route("/")
def index():
    return {"message": "healthy"}


@app.route("/message")
def health_check():
    return {"message": "OK"}
