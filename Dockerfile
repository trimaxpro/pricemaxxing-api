FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

ARG BUILD_TIME=none
COPY src/ ./src/
RUN cp src/main.py .

EXPOSE 8080
CMD ["python", "main.py"]
