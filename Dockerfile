FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN mkdir -p data static/icons

ENV FLASK_DEBUG=0

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "from urllib.request import urlopen; urlopen('http://localhost:3000/')" || exit 1

CMD ["python", "-m", "waitress", "--host=0.0.0.0", "--port=3000", "app:app"]
