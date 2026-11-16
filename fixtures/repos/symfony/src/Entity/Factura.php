<?php

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
#[ORM\Table(name: 'facturas_emitidas')]
class Factura
{
    #[ORM\Id]
    #[ORM\Column]
    private ?int $id = null;
}
