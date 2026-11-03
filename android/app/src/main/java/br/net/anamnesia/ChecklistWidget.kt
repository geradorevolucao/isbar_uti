package br.net.anamnesia

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import androidx.core.widget.RemoteViewsCompat

/** Widget "Checklist do CTI": leitos 1 a 10 (e os demais do CTI) com o número de itens não marcados em vermelho. */
class ChecklistWidget : AppWidgetProvider() {

    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        ids.forEach { render(ctx, mgr, it) }
    }

    companion object {
        fun updateAll(ctx: Context) {
            val mgr = AppWidgetManager.getInstance(ctx)
            mgr.getAppWidgetIds(ComponentName(ctx, ChecklistWidget::class.java)).forEach { render(ctx, mgr, it) }
        }

        private fun openIntent(ctx: Context, pt: String?): Intent =
            Intent(ctx, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                putExtra(MainActivity.EXTRA_CK, true)
                if (pt != null) putExtra(MainActivity.EXTRA_PT, pt)
            }

        private fun render(ctx: Context, mgr: AppWidgetManager, widgetId: Int) {
            val st = WidgetData.load(ctx)
            val v = RemoteViews(ctx.packageName, R.layout.widget)

            // tocar no cabeçalho abre o checklist; tocar num leito abre o checklist já naquele paciente
            v.setOnClickPendingIntent(R.id.header, PendingIntent.getActivity(ctx, 1, openIntent(ctx, ""),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            v.setPendingIntentTemplate(R.id.list, PendingIntent.getActivity(ctx, 2, openIntent(ctx, null),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE))

            v.setTextViewText(R.id.shift, WidgetData.shiftLabel(st?.plantao ?: WidgetData.shiftNow()))
            val total = st?.total ?: 0
            v.setViewVisibility(R.id.total, if (total > 0) View.VISIBLE else View.GONE)
            v.setTextViewText(R.id.total, total.toString())
            v.setTextViewText(R.id.empty, when (st?.estado) {
                "bloqueado" -> "Abra o Anamnesia e desbloqueie a conta para ver os leitos."
                else -> "Abra o Anamnesia para carregar os leitos."
            })

            val items = RemoteViewsCompat.RemoteCollectionItems.Builder().setHasStableIds(true).setViewTypeCount(2)
            st?.rows?.forEachIndexed { i, r ->
                val vago = r.id == null
                val item = RemoteViews(ctx.packageName, if (vago) R.layout.widget_item_vago else R.layout.widget_item)
                item.setTextViewText(R.id.bed, "Leito ${r.leito.ifEmpty { "–" }}")
                item.setTextViewText(R.id.ini, if (vago) "vago" else r.ini.ifEmpty { "Sem nome" })
                if (!vago) {
                    item.setViewVisibility(R.id.badge, if (r.n > 0) View.VISIBLE else View.GONE)
                    item.setTextViewText(R.id.badge, r.n.toString())
                    item.setViewVisibility(R.id.ok, if (r.n > 0) View.GONE else View.VISIBLE)
                }
                item.setOnClickFillInIntent(R.id.row, Intent().apply {
                    putExtra(MainActivity.EXTRA_CK, true)
                    putExtra(MainActivity.EXTRA_PT, r.id ?: "")
                })
                items.addItem(i.toLong(), item)
            }
            RemoteViewsCompat.setRemoteAdapter(ctx, v, widgetId, R.id.list, items.build())
            v.setEmptyView(R.id.list, R.id.empty)
            mgr.updateAppWidget(widgetId, v)
        }
    }
}
