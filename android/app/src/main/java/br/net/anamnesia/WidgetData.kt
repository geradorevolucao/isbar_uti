package br.net.anamnesia

import android.content.Context
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale

/**
 * Resumo enviado pelo site (window.AnamnesiaApp.updateWidget): só leito, iniciais e contagens.
 * Os itens fixos (Evolução, Prescrição, Solicitação de exames) valem por plantão: se o plantão mudou
 * desde o último envio (7h/19h), o widget conta todos os fixos como pendentes de novo, sem abrir o app.
 */
object WidgetData {
    private const val PREFS = "widget"
    private const val KEY = "json"

    data class Row(val leito: String, val id: String?, val ini: String, val n: Int)
    data class State(val estado: String, val plantao: String, val rows: List<Row>) {
        val total get() = rows.sumOf { it.n }
    }

    fun save(ctx: Context, json: String) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
    }

    /** Plantão atual no mesmo formato do site: "aaaa-mm-ddD" (7h–19h) ou "aaaa-mm-ddN" (19h–7h, data em que começou). */
    fun shiftNow(now: Calendar = Calendar.getInstance()): String {
        val h = now.get(Calendar.HOUR_OF_DAY)
        val d = now.clone() as Calendar
        if (h < 7) d.add(Calendar.DAY_OF_MONTH, -1)
        val iso = String.format(Locale.US, "%04d-%02d-%02d", d.get(Calendar.YEAR), d.get(Calendar.MONTH) + 1, d.get(Calendar.DAY_OF_MONTH))
        return iso + if (h in 7..18) "D" else "N"
    }

    fun shiftLabel(id: String): String {
        val p = id.take(10).split("-")
        val data = if (p.size == 3) "${p[2]}/${p[1]}" else ""
        return (if (id.endsWith("D")) "Plantão diurno · 7h–19h" else "Plantão noturno · 19h–7h") + if (data.isNotEmpty()) " · $data" else ""
    }

    fun load(ctx: Context): State? {
        val raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return null
        return try {
            val o = JSONObject(raw)
            val estado = o.optString("estado", "ok")
            val agora = shiftNow()
            if (estado != "ok") return State(estado, agora, emptyList())
            val mesmoPlantao = o.optString("plantao") == agora
            val fixos = o.optInt("fixos", 3)
            val beds = o.optJSONArray("beds")
            val rows = ArrayList<Row>()
            if (beds != null) for (i in 0 until beds.length()) {
                val b = beds.getJSONObject(i)
                val id = if (b.has("id")) b.getString("id") else null
                val n = if (id == null) 0 else (if (mesmoPlantao) b.optInt("fix") else fixos) + b.optInt("adic")
                rows.add(Row(b.optString("leito"), id, b.optString("ini"), n))
            }
            State("ok", agora, rows)
        } catch (_: Exception) { null }
    }
}
