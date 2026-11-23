variable "clave" {
  type      = string
  default   = "secreto-de-terraform"
  sensitive = true
}

variable "region" {
  type = string
}
