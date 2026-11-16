<?php

namespace App\Controller;

use App\Entity\Cliente;
use Sensio\Bundle\FrameworkExtraBundle\Configuration\Route;

/**
 * @Route("/legacy")
 */
class LegacyController
{
    /**
     * @Route("/clientes/{id}", methods={"GET", "HEAD"})
     */
    public function ver($id)
    {
        $ch = curl_init(getenv('CRM_URL') . '/clientes/' . $id);
        return $this->getDoctrine()->getRepository(Cliente::class)->find($id);
    }

    /**
     * @Route("/ping")
     */
    public function ping()
    {
        return 'pong';
    }
}
