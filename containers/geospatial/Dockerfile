FROM debian:bookworm-slim

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    python3-numpy \
    python3-netcdf4 \
    python3-pil \
    python3-rasterio \
  && rm -rf /var/lib/apt/lists/*
COPY processor.py /app/processor.py

EXPOSE 8080
CMD ["python3", "/app/processor.py"]
