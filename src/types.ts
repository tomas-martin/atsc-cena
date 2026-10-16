export type Step = 'fiesta' | 'entradas_datos' | 'pago' | 'confirmacion'

export type PaymentMethod = 'mercadopago' | 'naranja_x' | 'transferencia'
export type OrderStatus = 'pendiente' | 'pagado' | 'rechazado' | 'cancelado'

export interface BuyerDetails {
  fullName: string
  dni: string
  email: string
  phone: string
  attendees?: string[]
}

export interface CreateOrderRequest {
  buyer: BuyerDetails
  quantity: number
  paymentMethod: PaymentMethod
}

export interface IssuedTicket {
  ticketNumber: string
  attendeeName: string
  qrToken: string
  orderId: string
  eventName: string
  date: string
  venue: string
}

export interface OrderConfirmation {
  orderId: string
  buyer: BuyerDetails
  quantity: number
  totalArs: number
  paymentMethod: PaymentMethod
  tickets: IssuedTicket[]
  emailSent: boolean
  emailError?: string
}

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  mercadopago: 'Mercado Pago',
  naranja_x: 'Naranja X',
  transferencia: 'Transferencia bancaria',
}
