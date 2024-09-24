FROM python:3.11-slim

WORKDIR /usr/src/app
ENV FLASK_APP=main

COPY ./app /usr/src/app/

RUN pip install --upgrade pip
RUN pip install -r requirements.txt

CMD [ "flask", "run", "--host=0.0.0.0", "-p", "80", "--debug" ]
