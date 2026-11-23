FROM php:8.3-fpm
RUN apt-get update && apt-get install -y cron
# Tareas del sistema: una comentada y un comando que no es del repo no cuentan.
#RUN crontab -l | { cat; echo "*/5 * * * * cd /app && php bin/console app:vieja"; } | crontab -
RUN crontab -l | { cat; echo "5 0 * * * cd /app && /usr/local/bin/symfony console app:sincronizar:categorias"; } | crontab -
RUN crontab -l | { cat; echo "0 2 * * * cd /app && php bin/console app:vencer:tokens"; } | crontab -
RUN crontab -l | { cat; echo "0 1 * * * cd /app && php bin/console cache:clear"; } | crontab -
