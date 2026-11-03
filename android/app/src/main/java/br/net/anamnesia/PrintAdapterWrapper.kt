package br.net.anamnesia

import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter

/** Repassa tudo ao adaptador do WebView e avisa o site quando a impressão termina (evento afterprint). */
class PrintAdapterWrapper(private val inner: PrintDocumentAdapter, private val done: () -> Unit) : PrintDocumentAdapter() {
    override fun onStart() = inner.onStart()
    override fun onLayout(old: PrintAttributes?, new: PrintAttributes, cs: CancellationSignal?, cb: LayoutResultCallback, extras: Bundle?) =
        inner.onLayout(old, new, cs, cb, extras)
    override fun onWrite(pages: Array<out PageRange>, dest: ParcelFileDescriptor, cs: CancellationSignal?, cb: WriteResultCallback) =
        inner.onWrite(pages, dest, cs, cb)
    override fun onFinish() { inner.onFinish(); done() }
}
