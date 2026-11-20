\getenv keycloak_password KEYCLOAK_DB_PASSWORD
CREATE ROLE keycloak LOGIN PASSWORD :'keycloak_password';
CREATE DATABASE keycloak OWNER keycloak;
