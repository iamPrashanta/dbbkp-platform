FROM golang:1.22-alpine AS builder
WORKDIR /build
COPY main.go .
RUN go build -o dbbkp-agent main.go

# Minimal final image
FROM alpine:3.19
COPY --from=builder /build/dbbkp-agent /usr/local/bin/dbbkp-agent
ENTRYPOINT ["/usr/local/bin/dbbkp-agent"]
