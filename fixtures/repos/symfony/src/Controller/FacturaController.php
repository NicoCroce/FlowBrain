<?php

namespace App\Controller;

use App\Entity\Factura;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Contracts\HttpClient\HttpClientInterface;

#[Route('/facturas')]
class FacturaController
{
    public function __construct(private HttpClientInterface $http, private EntityManagerInterface $em) {}

    #[Route('', methods: ['GET'])]
    public function listar(): JsonResponse
    {
        $facturas = $this->em->getRepository(Factura::class)->findAll();
        return new JsonResponse($facturas);
    }

    #[Route(path: '/{id}/emitir', methods: ['POST', 'OPTIONS'])]
    public function emitir(int $id): JsonResponse
    {
        $this->http->request('POST', 'https://fiscal.example/api/comprobantes', ['json' => ['id' => $id]]);
        $factura = new Factura();
        $this->em->persist($factura);
        return new JsonResponse(['ok' => true]);
    }
}
