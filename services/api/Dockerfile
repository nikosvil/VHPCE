# VHPCE gateway image — runs BOTH the FastAPI API and the Arq worker; `command:` in
# compose selects which. It only orchestrates: it shells out to `docker run` against the
# HOST daemon (via the mounted /var/run/docker.sock) to spawn the locked-down sandbox
# containers. Untrusted code never executes in this image.
FROM python:3.12-slim

# Just the Docker *client* (no daemon) so the api/worker can drive the host socket.
ARG DOCKER_VERSION=27.3.1
ADD https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_VERSION}.tgz /tmp/docker.tgz
RUN tar -xzf /tmp/docker.tgz -C /usr/local/bin --strip-components=1 docker/docker \
 && rm /tmp/docker.tgz \
 && docker --version

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

EXPOSE 8000
# Default = API. The worker service overrides this with: arq worker.WorkerSettings
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
