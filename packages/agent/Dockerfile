FROM golang:1.22-alpine AS builder
WORKDIR /build
COPY go.mod .
COPY main.go .
COPY internal/ ./internal/
RUN go build -o dbbkp-agent .

# Minimal final image
FROM alpine:3.19
COPY --from=builder /build/dbbkp-agent /usr/local/bin/dbbkp-agent
ENTRYPOINT ["/usr/local/bin/dbbkp-agent"]
