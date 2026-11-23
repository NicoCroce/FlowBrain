terraform {
  required_version = ">= 1.5"
}

# resource "aws_s3_bucket" "comentado" {}

resource "aws_lambda_function" "api" {
  function_name = "productos"
  handler       = "dist/lambda.handler"
  runtime       = "nodejs20.x"
  memory_size   = 512
  environment {
    variables = {
      TABLA = "productos"
      CLAVE = var.clave
    }
  }
}

resource "aws_apigatewayv2_route" "listar" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /productos"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_route" "resto" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "ANY /productos/{proxy+}"
}

module "red" {
  source = "./modules/red"
  cidr   = "10.0.0.0/16"
}
