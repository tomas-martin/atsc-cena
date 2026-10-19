export type Step = 'fiesta' | 'entradas_datos' | 'pago' | 'confirmacion'

export type PaymentMethod = 'mercadopago' | 'naranja_x' | 'transferencia'
export type OrderStatus = 'pendiente' | 'pagado' | 'rechazado' | 'cancelado'

export type AttendeeRole = 'jugador' | 'acompanante'

export const CATEGORIES = [
  'C5',
  'C7',
  'C9',
  'C11',
  'C13',
  'C15',
  'C17',
  'C20',
  'Primera',
  'Seniors',
  'Veteranos'
] as const

export type Category = (typeof CATEGORIES)[number]

export interface AttendeeDetail {
  name: string
  role: AttendeeRole
  category: Category
}

export interface BuyerDetails {
  fullName: string
  dni: string
  email: string
  phone: string
  attendees?: string[]
  attendeeDetails?: AttendeeDetail[]
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
  isPlayer?: boolean
  role?: AttendeeRole
  category?: Category
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

