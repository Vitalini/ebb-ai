# Dockerfile for Glama.ai MCP server evaluation
# (paste into the Glama dashboard at https://glama.ai/mcp/servers/tidegap/tidegap
#  so the server becomes installable and gets a quality score)
FROM node:22-alpine

RUN npm install -g @tidegap/mcp

ENTRYPOINT ["tidegap-mcp"]
