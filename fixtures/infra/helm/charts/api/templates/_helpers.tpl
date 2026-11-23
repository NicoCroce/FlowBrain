{{- define "catalogo.fullname" -}}{{ .Release.Name }}-{{ .Chart.Name }}{{- end }}
