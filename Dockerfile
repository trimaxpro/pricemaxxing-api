FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Delete any cached main.py
RUN rm -f main.py

COPY src/main.py ./main.py

EXPOSE 8080
CMD ["python", "main.py"]
