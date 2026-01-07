FROM node:18-alpine AS builder

# Install build dependencies for libpostal
RUN apk add --no-cache \
    git \
    make \
    g++ \
    autoconf \
    automake \
    libtool \
    curl

# Clone and build libpostal
WORKDIR /tmp
RUN git clone https://github.com/openvenues/libpostal && \
    cd libpostal && \
    ./bootstrap.sh && \
    ./configure --datadir=/usr/share/libpostal && \
    make -j4 && \
    make install

# Download libpostal data (this takes a while but is required)
RUN libpostal_data_dir=/usr/share/libpostal && \
    mkdir -p $libpostal_data_dir && \
    /usr/local/bin/libpostal_data download all $libpostal_data_dir

# --- Runtime stage ---
FROM node:18-alpine

# Install runtime dependencies
RUN apk add --no-cache su-exec libstdc++

# Copy libpostal libraries and data from builder
COPY --from=builder /usr/local/lib/libpostal* /usr/local/lib/
COPY --from=builder /usr/local/include/libpostal /usr/local/include/libpostal
COPY --from=builder /usr/share/libpostal /usr/share/libpostal

# Update library cache
RUN ldconfig /usr/local/lib || true

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

COPY . .

USER root
EXPOSE 3001
CMD ["sh", "/app/entrypoint.sh"]
