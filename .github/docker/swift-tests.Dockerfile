FROM swift:6.2.3-jammy@sha256:33c73fc133767cdaafde26f0f9967c96ab25ff77618b7df1eabf46140bf2b6e6
# Optional public CA trust for managed environments; never copied into image layers.
# SQLite headers are in Ubuntu main. Avoid unrelated indexes and HTTP retry delays.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then \
      cat /etc/ssl/certs/ca-certificates.crt /run/secrets/proxy_ca > /tmp/apt-ca.pem; \
    else cp /etc/ssl/certs/ca-certificates.crt /tmp/apt-ca.pem; fi \
    && sed -i -e 's|http://|https://|g' \
      -e '/^deb / { / main/!d; s/ main .*/ main/; }' /etc/apt/sources.list \
    && apt-get -o Acquire::https::CaInfo=/tmp/apt-ca.pem update \
    && apt-get -o Acquire::https::CaInfo=/tmp/apt-ca.pem install -y --no-install-recommends libsqlite3-dev \
    && rm -rf /tmp/apt-ca.pem /var/lib/apt/lists/*
