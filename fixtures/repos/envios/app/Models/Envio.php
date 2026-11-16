<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Envio extends Model
{
    protected $table = 'envios';

    protected $fillable = ['destino', 'peso', 'zona', 'notas', 'costo', 'estado'];
}
